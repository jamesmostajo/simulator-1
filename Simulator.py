import numpy as np

class Simulator:
    
    probability_matrix = []
    state_actions = []
    time_series = []
    current_state = 0
    number_rounds = -1
    number_states = -1

    def __init__(self, markov_chain, initial_state, state_actions, number_rounds):
        self.probability_matrix = markov_chain
        self.state_actions = state_actions
        self.current_state = initial_state
        self.number_rounds = number_rounds
        self.number_states = len(self.probability_matrix)

    def generate_time_series_data(self):
        rng = np.random.default_rng()
        for rounds in range(self.number_rounds):
            state_decision = rng.choice(range(len(self.state_actions[self.current_state])), p=self.state_actions[self.current_state])
            prev_state = self.current_state
            self.current_state = rng.choice(range(self.number_states), p=self.probability_matrix[self.current_state])
            self.time_series.append([state_decision, prev_state])

    def get_data(self, time_t):
        return self.time_series[time_t]