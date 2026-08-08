/**
 * Reading Experience - Core Facade and Event Bus
 * Uses the Facade and Observer (Event Bus) patterns to decouple the Font and Theme engines 
 * from the specific document handlers (PDF, EPUB, Markdown).
 */

window.ReadingExperience = (function() {
  // --- Event Bus (Observer Pattern) ---
  const events = {};
  const cache = {}; // Cache last emitted values (Behavior Subject logic)

  const EventBus = {
    on: function(event, callback) {
      if (!events[event]) {
        events[event] = [];
      }
      events[event].push(callback);
      // Immediately invoke with cached state if available
      if (cache[event] !== undefined) {
        callback(cache[event]);
      }
    },
    
    emit: function(event, data) {
      cache[event] = data; // Cache state
      if (events[event]) {
        events[event].forEach(callback => {
          try {
            callback(data);
          } catch (err) {
            console.error(`Error in EventBus listener for ${event}:`, err);
          }
        });
      }
    }
  };

  return {
    Events: EventBus,
    // Engines will register themselves here
    Theme: null,
    Font: null
  };
})();
