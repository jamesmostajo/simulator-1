import numpy as np
rng = np.random.default_rng(seed=2026)

def random_prediction():
    return rng.choice([0, 1])

def window_based_prediction_choice(memory_window):
    count_tails = sum(memory_window)
    count_heads = len(memory_window)-count_tails

    if count_heads == count_tails:
        return -1

    return 0 if count_heads > count_tails else 1

def window_based_prediction_weighted(memory_window):
    count_tails = sum(memory_window)
    count_heads = len(memory_window)-count_tails

    if count_heads == count_tails:
        return -1

    return rng.choice([0, 1], p=[count_heads/(count_heads+count_tails), count_tails/(count_heads+count_tails)])

def exponential_moving_average_prediction_choice(memory_window, alpha, prediction_state):
    if len(memory_window) > 0:
        prediction_state["probability"] = alpha * memory_window[0] + (1 - alpha)*prediction_state["probability"]

    if prediction_state["probability"] == 0.5:
        return -1 
    
    return 1 if prediction_state["probability"] > 0.5 else 0

def exponential_moving_average_prediction_weighted(memory_window, alpha, prediction_state):
    if len(memory_window) > 0:
        prediction_state["probability"] = alpha * memory_window[0] + (1 - alpha)*prediction_state["probability"]

    return rng.choice([0, 1], p=[1-prediction_state["probability"], prediction_state["probability"]])

def oracle_prediction_choice(prediction_state):
    if prediction_state["probability"][0] == 0.5:
        return -1

    return 0 if prediction_state["probability"][0] > 0.5 else 1

def oracle_prediction_weighted(prediction_state):
    if prediction_state["probability"][0] == 0.5:
        return -1
    
    return rng.choice([0, 1], p=prediction_state["probability"])
