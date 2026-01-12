// Simple wake word detection using Web Speech API
// Listens for "Hey Aura" or "Aura" to activate the assistant

// TypeScript declarations for Web Speech API
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
}

export class WakeWordDetector {
    private recognition: any = null;
    private isListening: boolean = false;
    private onWakeWordDetected: () => void;
    private onListeningStateChange: (isListening: boolean) => void;

    constructor(
        onWakeWordDetected: () => void,
        onListeningStateChange: (isListening: boolean) => void
    ) {
        this.onWakeWordDetected = onWakeWordDetected;
        this.onListeningStateChange = onListeningStateChange;
    }

    start() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech recognition not supported in this browser');
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isListening = true;
            this.onListeningStateChange(true);
            console.log('Wake word detection started');
        };

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('')
                .toLowerCase();

            // Check for wake words
            if (
                transcript.includes('hey aura') ||
                transcript.includes('hi aura') ||
                transcript.includes('okay aura') ||
                (transcript.includes('aura') && transcript.split(' ').length <= 3)
            ) {
                console.log('Wake word detected:', transcript);
                this.onWakeWordDetected();
            }
        };

        this.recognition.onerror = (event: any) => {
            console.error('Wake word detection error:', event.error);
            if (event.error === 'no-speech') {
                // Restart on no-speech error
                setTimeout(() => this.restart(), 100);
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.onListeningStateChange(false);
            // Auto-restart to keep listening
            if (this.recognition) {
                setTimeout(() => this.restart(), 100);
            }
        };

        try {
            this.recognition.start();
        } catch (error) {
            console.error('Failed to start wake word detection:', error);
        }
    }

    private restart() {
        if (this.recognition && !this.isListening) {
            try {
                this.recognition.start();
            } catch (error) {
                // Ignore if already started
            }
        }
    }

    stop() {
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
            this.isListening = false;
            this.onListeningStateChange(false);
        }
    }

    getIsListening(): boolean {
        return this.isListening;
    }
}
