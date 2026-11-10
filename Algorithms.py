import numpy as np
rng = np.random.default_rng(seed=2026)

def prob_to_signal(probability):
    return 2*probability - 1

def random_prediction():
    return rng.choice([0, 1])

def window_based_prediction(memory_window):
    count_tails = sum(memory_window)
    prob_tails = count_tails / len(memory_window)
    return prob_to_signal(prob_tails)

def exponential_moving_average_prediction(memory_window, alpha, prediction_state):
    if len(memory_window) > 0:
        prediction_state["probability"] = alpha * memory_window[0] + (1 - alpha)*prediction_state["probability"]

    return prob_to_signal(prediction_state["probability"])

def oracle_prediction(prediction_state):
    return prob_to_signal(prediction_state["probability"])
