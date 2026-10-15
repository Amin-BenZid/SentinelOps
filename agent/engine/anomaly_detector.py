import statistics
from collections import defaultdict, deque

class AnomalyDetector:
    """
    Lightweight, real-time statistical anomaly detection using a rolling Z-score
    and dynamic confidence bounds (mu +/- k*sigma). Zero external dependencies.
    """
    def __init__(self, window_size: int = 30, k_threshold: float = 2.5, min_noise_floor: float = 2.0):
        self.window_size = window_size
        self.k_threshold = k_threshold
        self.min_noise_floor = min_noise_floor  # Avoids false positives on flat 0% metrics
        # Stores rolling metrics per entity:metric
        self.history = defaultdict(lambda: deque(maxlen=window_size))

    def evaluate_metric(self, entity_id: str, metric_name: str, value: float) -> dict:
        key = f"{entity_id}:{metric_name}"
        samples = self.history[key]

        # We need at least 10 samples to establish a baseline
        if len(samples) < 10:
            samples.append(value)
            return {
                "is_anomaly": False,
                "z_score": 0.0,
                "expected_mean": round(value, 2),
                "upper_bound": round(min(100.0, value + 10.0), 2),
                "lower_bound": round(max(0.0, value - 10.0), 2)
            }

        mean = statistics.mean(samples)
        stdev = statistics.stdev(samples)

        # Apply noise floor so flat metrics don't trigger on trivial 1% deltas
        effective_stdev = max(stdev, self.min_noise_floor)

        z_score = (value - mean) / effective_stdev
        upper_bound = min(100.0, mean + (self.k_threshold * effective_stdev))
        lower_bound = max(0.0, mean - (self.k_threshold * effective_stdev))

        # Absolute difference check: delta must be at least 8 units to trigger an alert
        is_outlier = abs(z_score) > self.k_threshold and abs(value - mean) >= 8.0

        # Push to rolling window
        samples.append(value)

        return {
            "is_anomaly": is_outlier,
            "z_score": round(z_score, 2),
            "expected_mean": round(mean, 2),
            "upper_bound": round(upper_bound, 2),
            "lower_bound": round(lower_bound, 2)
        }