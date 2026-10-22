from collections import deque

class Agent:
    stack_size = 0
    prediction_algorithm = None
    prediction_states_parameters = {}

    def __init__(self, agent_type, initial_stack, prediction_algorithm, memory_window_size=0, prediction_algorithm_parameters={}):
        self.agent_type = agent_type
        self.stack_size = initial_stack
        self.prediction_algorithm = prediction_algorithm
        self.prediction_states_parameters = prediction_algorithm_parameters.copy()
        self.output_stats =  [0, 0, 0] #win, no-part, lose
        if memory_window_size > 0:
            self.prediction_states_parameters["memory_window"] = deque(maxlen=memory_window_size)

    def __repr__(self):
        return f"Agent of type {self.agent_type} has {self.output_stats[0]} correct outputs out of {self.output_stats[0] + self.output_stats[2]} guesses, with {self.output_stats[0]/(self.output_stats[0] + self.output_stats[2]):.2f} win rate"
    
    def make_prediction_decision(self):
        return self.prediction_algorithm(**self.prediction_states_parameters)

    def adjust_memory(self, data):
        self.prediction_states_parameters["memory_window"].appendleft(data)

    