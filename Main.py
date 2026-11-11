from Agents import Agent
from Simulator import Simulator
from Algorithms import *
from Results import save_results
import itertools
import numpy as np

# universal seeding, every random generator in the run is derived from this one seed
MASTER_SEED = 2026
master_seed_sequence = np.random.SeedSequence(MASTER_SEED)
simulator_seed, agents_seed = master_seed_sequence.spawn(2) # independent streams for the game and the agents

""" 
This game is defined as the following, there are three coins,
two of which are biased, one is biased to flip heads 75% of the time,
another is biased to flip tails 75% of the time. From the biased coins,
the next flip is 15% to be the fair coin, 15% to be the other biased coin,
and 70% to be the same coin. For the fair coin, the next flip is 20% for 
each biased coin and 60% to be fair again. Game starts with the fair coin
"""
probability_matrix = [
    [0.6, 0.2, 0.2], # fair
    [0.15, 0.7, 0.15], # heads biased
    [0.15, 0.15, 0.7], # tails biased
]
state_actions = [ # 0 is heads, 1 is tails
    [0.5, 0.5],  # fair
    [0.75, 0.25], # heads biased
    [0.25, 0.75], # tails biased
]
initial_state = 0

number_rounds = 1000
simulator = Simulator(
    markov_chain=probability_matrix,
    initial_state=initial_state,
    state_actions=state_actions,
    number_rounds=number_rounds,
    seed=simulator_seed
)
simulator.generate_time_series_data()

agents = []
agent_initial_stack_size = 200

# betting parameter grids
tolerance_values = [0.0, 0.05, 0.1, 0.2, 0.3] # minimum |signal| needed to place a bet
fractional_size_scales = [0.01, 0.02, 0.05, 0.1, 0.2] # fraction of stack bet each round
kelly_size_scales = [0.25, 0.5, 0.75, 1.0] # fraction of the kelly bet (1.0 = full kelly)

betting_algorithms = {
    "fractional": {"algorithm": fractional_betting, "size_scales": fractional_size_scales},
    "kelly": {"algorithm": kelly_betting, "size_scales": kelly_size_scales},
}

betting_configurations = []
for betting_name, betting in betting_algorithms.items():
    for size_scale, tolerance in itertools.product(betting["size_scales"], tolerance_values):
        betting_configurations.append({
            "name": betting_name,
            "algorithm": betting["algorithm"],
            "parameters": {"tolerance": tolerance, "size_scale": size_scale},
            "labels": {betting_name, f"size={size_scale}", f"tol={tolerance}"},
            "info": {"betting": betting_name, "size_scale": size_scale, "tolerance": tolerance},
        })

agent_memory_windows = [2, 6, 10, 20, 50]
alpha_values = [0.05, 0.2, 0.5]
random_config = [{"labels": {"random"}, "info": {"predictor": "random"}, "algorithm": random_prediction, "uses_rng": True}]
window_configs = [
    {
        "labels": {"window", f"window={window_size}"},
        "info": {"predictor": "window", "window": window_size},
        "algorithm": window_based_prediction,
        "memory_window_size": window_size,
    }
    for window_size in agent_memory_windows
]
ema_configs = [
    {
        "labels": {"alpha", f"alpha={alpha}"},
        "info": {"predictor": "ema", "alpha": alpha},
        "algorithm": exponential_moving_average_prediction,
        "memory_window_size": 1,
        "parameters": {"alpha": alpha, "prediction_state": {"probability": 0.5}},
    }
    for alpha in alpha_values
]
prediction_configurations = random_config + window_configs + ema_configs

# every prediction configuration x every betting configuration
for prediction, betting in itertools.product(prediction_configurations, betting_configurations):
    agents.append(
        Agent(
            agent_type=prediction["labels"] | betting["labels"],
            agent_info=prediction["info"] | betting["info"],
            initial_stack=agent_initial_stack_size,
            prediction_algorithm=prediction["algorithm"],
            memory_window_size=prediction.get("memory_window_size", 0),
            prediction_algorithm_parameters=prediction.get("parameters"),
            betting_algorithm=betting["algorithm"],
            betting_algorithm_parameters=betting["parameters"],
            uses_rng=prediction.get("uses_rng", False),
            seed=agents_seed.spawn(1)[0],
        )
    )

# add oracle agent
agents.append(
    Agent(
        agent_type={"oracle"},
        agent_info={"predictor": "oracle", "betting": "kelly", "size_scale": 1, "tolerance": 0},
        initial_stack=agent_initial_stack_size,
        prediction_algorithm=oracle_prediction,
        prediction_algorithm_parameters={
            "prediction_state" : {"probability": [0.5,  0.5]}
        },
        betting_algorithm=kelly_betting,
        betting_algorithm_parameters={"tolerance": 0, "size_scale": 1},
        observes_hidden_state=True,
        seed=agents_seed.spawn(1)[0],
    )
)

for round_number in range(number_rounds):
    result, state_to_get_current_result = simulator.get_data(round_number)
    for agent in agents:
        if agent.bankrupt: # out of the game, stops recording
            continue

        if agent.observes_hidden_state:
            agent.update_hidden_state(state_actions[state_to_get_current_result])

        bet_fraction, bet_side = agent.make_bet()

        if agent.uses_memory:
            agent.adjust_memory(result)

        agent.settle(bet_fraction, bet_side, result, round_number)

for x in agents:
    print(x)

# save the run in the standard results format (see Results.py)
run_info = {
    "master_seed": MASTER_SEED,
    "initial_state": initial_state,
    "probability_matrix": probability_matrix,
    "state_actions": state_actions,
    "initial_stack": agent_initial_stack_size,
    "log_minimum_bet": agents[0].log_minimum_bet,
    "tolerance_values": tolerance_values,
    "fractional_size_scales": fractional_size_scales,
    "kelly_size_scales": kelly_size_scales,
    "agent_memory_windows": agent_memory_windows,
    "alpha_values": alpha_values,
}
run_dir = save_results(agents, simulator, run_info)
print(f"\nresults saved to {run_dir}")
