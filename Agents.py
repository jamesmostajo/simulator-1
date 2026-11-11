from collections import deque
import copy
import math
import numpy as np

class Agent:
    stack_size = 0
    prediction_algorithm = None
    betting_algorithm = None

    def __init__(self, agent_type, initial_stack, prediction_algorithm, betting_algorithm, memory_window_size=0, prediction_algorithm_parameters=None, betting_algorithm_parameters=None, observes_hidden_state=False, uses_rng=False, seed=None):
        self.agent_type = agent_type
        self.stack_size = initial_stack
        self.initial_stack = initial_stack
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

        self.minimum_bet = 1
        self.bankrupt = False
        self.bankrupt_round = None

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

        if not math.isfinite(self.stack_size):
            stack = "overflow"
            growth = "n/a"
        elif self.bankrupt:
            stack = f"bankrupt in round {self.bankrupt_round} ({self.stack_size:.3g} left)"
            growth = f"{self.stack_size / self.initial_stack:.3g}x"
        else:
            stack = f"{self.stack_size:.4g}"
            growth = f"{self.stack_size / self.initial_stack:.3g}x"

        return (
            f"[{label}] "
            f"stack {stack} ({growth} of {self.initial_stack}) | "
            f"bets {bets} (W {wins} / L {losses}), skipped {skips} | "
            f"win rate {win_rate}"
        )
    
    def make_bet(self):
        if self.bankrupt or self.stack_size < self.minimum_bet:
            self.bankrupt = True
            return (0, None)

        prediction_signal = self.prediction_algorithm(**self.prediction_states_parameters)
        bet, bet_side = self.betting_algorithm(self.stack_size, prediction_signal, **self.betting_params)

        if 0 < bet and bet < self.minimum_bet:
            bet = self.minimum_bet

        return (bet, bet_side)

    def adjust_memory(self, data):
        self.prediction_states_parameters["memory_window"].appendleft(data)

    def update_hidden_state(self, state_probabilities):
        self.prediction_states_parameters["prediction_state"]["probability"] = state_probabilities

    