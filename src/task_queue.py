import asyncio
import logging
import os
import time
from typing import Dict, Any, Callable, Optional


logger = logging.getLogger(__name__)

class DocumentTaskQueue:
    # Maximum number of tasks that can wait in the queue at once.
    # Prevents unbounded memory growth under heavy load.
    MAX_QUEUE_DEPTH = int(os.environ.get("AURA_MAX_QUEUE_DEPTH", "50"))

    def __init__(self, concurrency: int = 1):
        self.concurrency = concurrency
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=self.MAX_QUEUE_DEPTH)
        self.tasks: Dict[str, Dict[str, Any]] = {}  # task_id -> task_meta
        self.workers = []
        self.running = False
        
    def _prune_old_tasks(self, max_tasks: int = 200, ttl_seconds: int = 3600):
        """Prunes old completed or failed tasks to prevent memory growth."""
        if len(self.tasks) <= max_tasks:
            return
        now = time.time()
        to_delete = []
        for tid, t in self.tasks.items():
            if t.get("status") in ("completed", "failed"):
                if t.get("completed_at") and (now - t["completed_at"] > ttl_seconds):
                    to_delete.append(tid)
                elif len(self.tasks) - len(to_delete) > max_tasks:
                    to_delete.append(tid)
        for tid in to_delete:
            self.tasks.pop(tid, None)

    def add_task(self, task_id: str, user_id: int, fn: Callable, *args, **kwargs):
        """Adds a conversion task to the queue. Raises QueueFull if the queue is at capacity."""
        self._prune_old_tasks()
        if self.queue.full():
            raise RuntimeError(
                f"Server is busy — conversion queue is full ({self.MAX_QUEUE_DEPTH} tasks). "
                "Please try again in a few minutes."
            )
        # B-07 FIX: enqueue FIRST — if put_nowait raises, we never write to self.tasks
        self.queue.put_nowait((task_id, fn, args, kwargs))
        self.tasks[task_id] = {
            "status": "pending",
            "user_id": user_id,
            "progress": 0,
            "total": 0,
            "error": None,
            "created_at": time.time(),
            "started_at": None,
            "completed_at": None,
            "file_url": None
        }
        logger.info(f"TaskQueue: Enqueued task {task_id}.")

    def get_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves task details and current queue position."""
        task = self.tasks.get(task_id)
        if not task:
            return None
            
        # Determine queue position if task is pending
        position = 0
        if task["status"] == "pending":
            # Count how many elements are ahead of it in the internal queue list
            # We can inspect the internal queue queue list safely
            try:
                queue_items = list(self.queue._queue)
                for idx, item in enumerate(queue_items):
                    if item[0] == task_id:
                        position = idx + 1
                        break
            except Exception:
                position = 1
                
        return {
            "status": task["status"],
            "progress": task["progress"],
            "total": task["total"],
            "error": task["error"],
            "queue_position": position,
            "started_at": task["started_at"],
            "completed_at": task["completed_at"],
            "file_url": task["file_url"]
        }

    def update_progress(self, task_id: str, progress: int, total: int):
        """Updates page rendering metrics for a running task."""
        if task_id in self.tasks:
            self.tasks[task_id]["progress"] = progress
            self.tasks[task_id]["total"] = total

    def set_completed(self, task_id: str, file_url: str):
        """Marks task as successfully converted and saves file locator."""
        if task_id in self.tasks:
            self.tasks[task_id]["status"] = "completed"
            self.tasks[task_id]["completed_at"] = time.time()
            self.tasks[task_id]["file_url"] = file_url
            logger.info(f"TaskQueue: Task {task_id} completed successfully.")

    def set_failed(self, task_id: str, error_msg: str):
        """Marks task as failed and logs error stack."""
        if task_id in self.tasks:
            self.tasks[task_id]["status"] = "failed"
            self.tasks[task_id]["completed_at"] = time.time()
            self.tasks[task_id]["error"] = error_msg
            logger.error(f"TaskQueue: Task {task_id} failed: {error_msg}")

    async def start(self):
        """Starts the queue workers."""
        if self.running:
            return
        self.running = True
        for i in range(self.concurrency):
            worker = asyncio.create_task(self._worker_loop(i))
            self.workers.append(worker)
        logger.info(f"TaskQueue: Started {self.concurrency} background workers.")

    async def stop(self):
        """Stops the queue workers and waits for completion."""
        self.running = False
        for worker in self.workers:
            worker.cancel()
        self.workers = []
        logger.info("TaskQueue: Stopped workers.")

    async def _worker_loop(self, worker_id: int):
        """Infinite worker task loop."""
        while self.running:
            try:
                task_id, fn, args, kwargs = await self.queue.get()
            except asyncio.CancelledError:
                break
                
            try:
                logger.info(f"Worker-{worker_id}: Processing task {task_id}...")
                self.tasks[task_id]["status"] = "processing"
                self.tasks[task_id]["started_at"] = time.time()
                
                # Execute conversion fn asynchronously in a threadpool so it doesn't block event loop
                loop = asyncio.get_running_loop()
                # Run the blocking function in a separate executor thread
                await loop.run_in_executor(None, fn, *args, **kwargs)
                
                logger.info(f"Worker-{worker_id}: Successfully completed task {task_id}.")
                # B-02 FIX: only set completed if fn didn't already call set_completed()
                # (run_full_conversion_job calls task_queue.set_completed() internally)
                if self.tasks.get(task_id, {}).get("status") not in ("completed", "failed"):
                    self.tasks[task_id]["status"] = "completed"
                    self.tasks[task_id]["completed_at"] = time.time()
                
            except Exception as e:
                logger.error(f"Worker-{worker_id}: Exception in task {task_id}: {e}", exc_info=True)
                self.set_failed(task_id, str(e))
            finally:
                self.queue.task_done()

# Create a globally available instance
task_queue = DocumentTaskQueue(concurrency=2)
