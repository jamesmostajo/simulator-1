from Agents import Agent
from Simulator import Simulator
from Algorithms import *
import itertools

""" 
This game is defined as the following, there are three coins,
two of which are biased, one is biased to flip heads 75% of the time,
another is biased to flip tails 75% of the time. From the biased coins,
the next flip is 50% to be the fair coin, 15% to be the other biased coin,
and 35% to be the same coin. For the fair coin, the next flip is 40% for 
each biased coin and 20% to be fair again. Game starts with the fair coin
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

number_rounds = 10000
simulator = Simulator(
    markov_chain=probability_matrix,
    initial_state=initial_state,
    state_actions=state_actions,
    number_rounds=number_rounds
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
        })

agent_memory_windows = [2, 6, 10, 20, 50]
alpha_values = [0.05, 0.2, 0.5]
random_config = [{"labels": {"random"}, "algorithm": random_prediction}]
window_configs = [
    {
        "labels": {"window", f"window={window_size}"},
        "algorithm": window_based_prediction,
        "memory_window_size": window_size,
    }
    for window_size in agent_memory_windows
]
ema_configs = [
    {
        "labels": {"alpha", f"alpha={alpha}"},
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
            initial_stack=agent_initial_stack_size,
            prediction_algorithm=prediction["algorithm"],
            memory_window_size=prediction.get("memory_window_size", 0),
            prediction_algorithm_parameters=prediction.get("parameters"),
            betting_algorithm=betting["algorithm"],
            betting_algorithm_parameters=betting["parameters"],
        )
    )

# add oracle agent
agents.append(
    Agent(
        agent_type={"oracle"},
        initial_stack=agent_initial_stack_size,
        prediction_algorithm=oracle_prediction,
        prediction_algorithm_parameters={
            "prediction_state" : {"probability": [0.5,  0.5]}
        },
        betting_algorithm=kelly_betting,
        betting_algorithm_parameters={"tolerance": 0, "size_scale": 1}
    )
)

for round in range(number_rounds):
    result, state_to_get_current_result = simulator.get_data(round)
    for agent in agents:
        if "oracle" in agent.agent_type:
            agent.prediction_states_parameters["prediction_state"]["probability"] = state_actions[state_to_get_current_result]

        prediction = agent.make_prediction_decision()

        if "window" in agent.agent_type or "alpha" in agent.agent_type:
            agent.adjust_memory(result)

        if prediction == result:
            agent.output_stats[0] += 1
        elif prediction == -1:
            agent.output_stats[1] += 1
        else:
            agent.output_stats[2] += 1

for x in agents:
    print(x)