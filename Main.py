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

# add random agents
agents.append(
    Agent(
        agent_type={"random"},
        initial_stack=agent_initial_stack_size,
        prediction_algorithm=random_prediction,
    )
)

# add window based agents
agent_memory_windows = [2, 6, 10, 20, 50]

for window_size in agent_memory_windows:
    agents.append(
        Agent(
            agent_type={"window", "decider", window_size},
            initial_stack=agent_initial_stack_size,
            memory_window_size=window_size,
            prediction_algorithm=window_based_prediction_choice,
        )
    )
    # agents.append(
    #     Agent(
    #         agent_type={"window", "weighted", window_size},
    #         initial_stack=agent_initial_stack_size,
    #         memory_window_size=window_size,
    #         prediction_algorithm=window_based_prediction_weighted,
    #     )
    # )

# add ema based agents
alpha_values = [0.05, 0.2, 0.5]

for alpha in alpha_values:
    agents.append(
        Agent(
            agent_type={"alpha", "decider", alpha},
            initial_stack=agent_initial_stack_size,
            prediction_algorithm=exponential_moving_average_prediction_choice,
            memory_window_size=1,
            prediction_algorithm_parameters={
                "alpha" : alpha,
                "prediction_state" : {"probability" : 0.5}
            }
        )
    )

    # agents.append(
    #     Agent(
    #         agent_type={"alpha", "weighted", alpha},
    #         initial_stack=agent_initial_stack_size,
    #         prediction_algorithm=exponential_moving_average_prediction_weighted,
    #         memory_window_size=1,
    #         prediction_algorithm_parameters={
    #             "alpha" : alpha,
    #             "prediction_state" : {"probability" : 0.5}
    #         }
    #     )
    # )

# add oracle agent
agents.append(
    Agent(
        agent_type={"oracle", "decider"},
        initial_stack=agent_initial_stack_size,
        prediction_algorithm=oracle_prediction_choice,
        prediction_algorithm_parameters={
            "prediction_state" : {"probability": [0.5, 0.5]}
        }
    )
)

# agents.append(
#     Agent(
#         agent_type={"oracle", "weighted"},
#         initial_stack=agent_initial_stack_size,
#         prediction_algorithm=oracle_prediction_weighted,
#         prediction_algorithm_parameters={
#             "prediction_state" : {"probability": [0.5, 0.5]}
#         }
#     )
# )

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