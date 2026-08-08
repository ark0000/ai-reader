/**
 * brightness-engine.js
 * Smart Environment-Based Brightness Engine using Strategy & Factory Patterns.
 */

// ─── Strategies ──────────────────────────────────────────────────────────────

class AmbientSensorStrategy {
    constructor() {
        this.sensor = null;
        this.callback = null;
    }

    async start(callback) {
        this.callback = callback;
        if (!('AmbientLightSensor' in window)) {
            throw new Error('AmbientLightSensor not supported');
        }
        
        try {
            // Some browsers require explicit permission
            if (navigator.permissions) {
                const status = await navigator.permissions.query({ name: 'ambient-light-sensor' });
                if (status.state === 'denied') throw new Error('Permission denied');
            }

            this.sensor = new AmbientLightSensor();
            this.sensor.addEventListener('reading', () => {
                const lux = this.sensor.illuminance;
                // Logarithmic mapping: 10 lux -> ~0.5, 1000 lux -> ~1.2
                let brightness = Math.max(0.5, Math.min(1.5, Math.log10(lux + 1) * 0.3));
                if (this.callback) this.callback(brightness);
            });
            this.sensor.start();
            return true;
        } catch (err) {
            console.warn("Ambient sensor error:", err);
            throw err;
        }
    }

    stop() {
        if (this.sensor) {
            this.sensor.stop();
            this.sensor = null;
        }
        this.callback = null;
    }
}

class AIAdaptiveStrategy {
    constructor() {
        this.callback = null;
        this.timer = null;
        this.loadModel();
    }

    loadModel() {
        try {
            const data = localStorage.getItem('aura_brightness_model');
            this.model = data ? JSON.parse(data) : {};
        } catch (e) {
            this.model = {};
        }
    }

    saveModel() {
        localStorage.setItem('aura_brightness_model', JSON.stringify(this.model));
    }

    train(hour, brightness) {
        if (!this.model[hour]) {
            this.model[hour] = { val: brightness, weight: 1 };
        } else {
            const cur = this.model[hour];
            cur.val = ((cur.val * cur.weight) + brightness) / (cur.weight + 1);
            cur.weight++;
        }
        this.saveModel();
    }

    getEstimatedBrightness() {
        const hour = new Date().getHours();
        
        // If we have training data for this hour, use it.
        if (this.model[hour]) {
            return this.model[hour].val;
        }
        
        // Fallback: Time of day sine wave mapping if no training data
        // 12 PM = 1.2 (Brightest), 12 AM = 0.6 (Darkest)
        const timeFactor = (Math.sin((hour - 6) * Math.PI / 12) + 1) / 2;
        return 0.6 + (timeFactor * 0.6);
    }

    async start(callback) {
        this.callback = callback;
        
        const update = () => {
            if (this.callback) {
                this.callback(this.getEstimatedBrightness());
            }
        };
        
        update();
        // Update every minute in case the hour changes
        this.timer = setInterval(update, 60000);
        return true;
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.callback = null;
    }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

class BrightnessStrategyFactory {
    static async create() {
        const sensor = new AmbientSensorStrategy();
        try {
            // Attempt to start the sensor temporarily to see if it throws permission error
            await sensor.start(() => {});
            sensor.stop();
            console.log("[Brightness] Using AmbientLightSensor Strategy");
            return sensor;
        } catch (e) {
            console.log("[Brightness] Falling back to AI Adaptive Strategy");
            return new AIAdaptiveStrategy();
        }
    }
}

// ─── Facade ──────────────────────────────────────────────────────────────────

class BrightnessManager {
    constructor() {
        this.strategy = null;
        this.isActive = false;
        this.onChange = null;
        this.aiTrainer = new AIAdaptiveStrategy(); // Used for training regardless of active strategy
    }

    async enableAuto(onChangeCallback) {
        this.onChange = onChangeCallback;
        if (this.isActive) return;

        if (!this.strategy) {
            this.strategy = await BrightnessStrategyFactory.create();
        }

        this.isActive = true;
        this.strategy.start((brightness) => {
            if (this.isActive && this.onChange) {
                // Apply exponential smoothing for transition if needed, though CSS handles transition
                this.onChange(brightness);
            }
        });
    }

    disableAuto() {
        if (this.isActive && this.strategy) {
            this.strategy.stop();
        }
        this.isActive = false;
    }

    recordManualOverride(brightness) {
        this.disableAuto();
        const hour = new Date().getHours();
        this.aiTrainer.train(hour, brightness);
        console.log(`[Brightness] Trained AI model for hour ${hour} -> ${brightness.toFixed(2)}`);
    }
}

window.BrightnessManager = new BrightnessManager();
