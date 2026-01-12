
export interface Memory {
  id: string;
  content: string;
  timestamp: number;
}

export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface AssistantState {
  status: SessionStatus;
  isSpeaking: boolean;
  memories: Memory[];
  transcript: {
    user: string;
    model: string;
  };
}
