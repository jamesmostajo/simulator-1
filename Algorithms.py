def prob_to_signal(probability):
    return 2*probability - 1

def gate(signal, tolerance):
    return 1 if abs(signal) > tolerance else 0

def side(signal):
    return 0 if signal < 0 else 1

# prediction algorithms
def random_prediction(rng):
    return prob_to_signal(rng.random())

def window_based_prediction(memory_window):
    if len(memory_window) == 0:
        return 0

    count_tails = sum(memory_window)
    prob_tails = count_tails / len(memory_window)
    return prob_to_signal(prob_tails)

def exponential_moving_average_prediction(memory_window, alpha, prediction_state):
    if len(memory_window) > 0:
        prediction_state["probability"] = alpha * memory_window[0] + (1 - alpha)*prediction_state["probability"]

    return prob_to_signal(prediction_state["probability"])

def oracle_prediction(prediction_state):
    return prob_to_signal(prediction_state["probability"][1]) # we only need P(Tails) to get signal

# betting algorithms
def fractional_betting(stack, signal, tolerance, size_scale):
    return (gate(signal, tolerance) * stack * size_scale, side(signal))

def kelly_betting(stack, signal, tolerance, size_scale, b=1):
    probability = (abs(signal)+1)/2
    optimal_bet = probability - ((1-probability)/b)
    return (gate(signal, tolerance) * optimal_bet * stack * size_scale, side(signal))