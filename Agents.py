from collections import deque
import copy
import math
import numpy as np

class Agent:
    prediction_algorithm = None
    betting_algorithm = None

    def __init__(self, agent_type, initial_stack, prediction_algorithm, betting_algorithm, memory_window_size=0, prediction_algorithm_parameters=None, betting_algorithm_parameters=None, observes_hidden_state=False, uses_rng=False, seed=None, agent_info=None):
        self.agent_type = agent_type
        self.agent_info = dict(agent_info) if agent_info is not None else {} # structured settings, used for exporting results
        self.prediction_algorithm = prediction_algorithm
        self.betting_algorithm = betting_algorithm

        if betting_algorithm_parameters is None:
            self.betting_params = {}
        else:
            self.betting_params = copy.deepcopy(betting_algorithm_parameters)

        if prediction_algorithm_parameters is None:
            self.prediction_states_parameters = {}
        else:
            self.prediction_states_parameters = copy.deepcopy(prediction_algorithm_parameters)

        # all money is tracked as natural logs so stacks can grow without overflowing,
        # initial_stack and the minimum bet of 1 are converted once here
        self.log_minimum_bet = math.log(1)
        self.bankrupt = False
        self.bankrupt_round = None

        self.initial_log_stack = math.log(initial_stack)
        self.log_stack = self.initial_log_stack
        # log stack over time: index 0 is before round 0, index t + 1 is after round t
        # stops growing once the agent is bankrupt
        self.log_stack_history = [self.log_stack]

        self.output_stats =  [0, 0, 0] #win, no-part, lose

        # behaviour flags, the simulation loop checks these instead of agent_type labels
        self.uses_memory = memory_window_size > 0
        self.observes_hidden_state = observes_hidden_state # oracle only condition

        if self.uses_memory:
            self.prediction_states_parameters["memory_window"] = deque(maxlen=memory_window_size)

        self.rng = np.random.default_rng(seed)
        if uses_rng:
            self.prediction_states_parameters["rng"] = self.rng

    def __repr__(self):
        wins, skips, losses = self.output_stats
        bets = wins + losses
        win_rate = f"{wins / bets:.1%}" if bets > 0 else "n/a"
        label = ", ".join(sorted(map(str, self.agent_type)))
        status = f", bankrupt in round {self.bankrupt_round}" if self.bankrupt else ""

        return (
            f"[{label}] "
            f"log stack {self.log_stack:.3f} (log growth {self.log_stack - self.initial_log_stack:+.3f}{status}) | "
            f"bets {bets} (W {wins} / L {losses}), skipped {skips} | "
            f"win rate {win_rate}"
        )

    def make_bet(self):
        # returns (fraction of the stack to bet, side), a fraction of 0 means skip
        if self.bankrupt or self.log_stack < self.log_minimum_bet:
            self.bankrupt = True
            return (0, None)

        prediction_signal = self.prediction_algorithm(**self.prediction_states_parameters)
        bet_fraction, bet_side = self.betting_algorithm(prediction_signal, **self.betting_params)

        # a bet smaller than the minimum is raised to the minimum, done in log space:
        # fraction * stack < minimum bet  <=>  log(fraction) + log_stack < log_minimum_bet
        if bet_fraction > 0 and math.log(bet_fraction) + self.log_stack < self.log_minimum_bet:
            bet_fraction = math.exp(self.log_minimum_bet - self.log_stack)

        return (bet_fraction, bet_side)

    def settle(self, bet_fraction, bet_side, result, round_number):
        # pays out the bet, updates the stats and records this round's log stack
        if bet_fraction <= 0: # gated out, no participation
            self.output_stats[1] += 1
        elif bet_side == result:
            self.output_stats[0] += 1
            self.log_stack += math.log1p(bet_fraction)
        else:
            self.output_stats[2] += 1
            self.log_stack = math.log1p(-bet_fraction) + self.log_stack if bet_fraction < 1 else -math.inf

        self.log_stack_history.append(self.log_stack)

        # can't cover the minimum bet anymore
        if self.log_stack < self.log_minimum_bet:
            self.bankrupt = True
            self.bankrupt_round = round_number

    def adjust_memory(self, data):
        self.prediction_states_parameters["memory_window"].appendleft(data)

    def update_hidden_state(self, state_probabilities):
        self.prediction_states_parameters["prediction_state"]["probability"] = state_probabilities
