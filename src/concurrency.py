import os
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import logging

logger = logging.getLogger(__name__)

class ConcurrencyStrategy(ABC):
    @abstractmethod
    def execute(self, func, tasks, max_workers, progress_callback=None):
        """
        Executes a list of tasks in parallel.
        :param func: The worker function to execute.
        :param tasks: A list of kwargs dictionaries representing tasks.
        :param max_workers: Maximum number of parallel workers.
        :param progress_callback: Optional callback func(completed_count, total).
        :return: A list of results from the worker function.
        """
        pass


class ThreadPoolStrategy(ConcurrencyStrategy):
    def execute(self, func, tasks, max_workers, progress_callback=None):
        logger.info(f"Using ThreadPoolStrategy with max_workers={max_workers}")
        results = []
        total = len(tasks)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(func, **task): task for task in tasks}
            completed_count = 0
            for future in as_completed(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    logger.error(f"Error in ThreadPool worker: {e}", exc_info=True)
                    raise e
                
                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, total)
        return results


class ProcessPoolStrategy(ConcurrencyStrategy):
    def execute(self, func, tasks, max_workers, progress_callback=None):
        logger.info(f"Using ProcessPoolStrategy with max_workers={max_workers}")
        results = []
        total = len(tasks)
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(func, **task): task for task in tasks}
            completed_count = 0
            for future in as_completed(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    logger.error(f"Error in ProcessPool worker: {e}", exc_info=True)
                    raise e
                
                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, total)
        return results


class ConcurrencyFactory:
    # Configurable thresholds for Auto mode tuning
    AUTO_PAGE_COUNT_THRESHOLD = 10
    AUTO_PIXEL_AREA_THRESHOLD = 50_000_000  # e.g. 50 megapixels total

    @staticmethod
    def get_strategy(mode: str, total_tasks: int = 1, max_workers: int = 4, total_pixel_area: int = 0) -> ConcurrencyStrategy:
        mode = mode.lower()
        if mode == "auto":
            # Smart default based on document size and pixel density
            if total_tasks > ConcurrencyFactory.AUTO_PAGE_COUNT_THRESHOLD or total_pixel_area > ConcurrencyFactory.AUTO_PIXEL_AREA_THRESHOLD:
                logger.info(f"Auto → Processes ({max_workers} workers) selected (tasks={total_tasks}, area={total_pixel_area})")
                return ProcessPoolStrategy()
            else:
                logger.info(f"Auto → Threads ({max_workers} workers) selected (tasks={total_tasks}, area={total_pixel_area})")
                return ThreadPoolStrategy()
        elif mode == "processes":
            return ProcessPoolStrategy()
        elif mode == "threads":
            return ThreadPoolStrategy()
        else:
            logger.warning(f"Unknown concurrency mode '{mode}', defaulting to ThreadPool.")
            return ThreadPoolStrategy()
