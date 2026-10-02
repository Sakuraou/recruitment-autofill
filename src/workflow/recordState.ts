export type RecordWorkflowPhase = 'idle' | 'preparing' | 'running' | 'pausing' | 'paused' | 'review' | 'complete' | 'stopped';
export interface RecordWorkflowState {
  readonly phase: RecordWorkflowPhase;
  readonly total: number;
  readonly canStart: boolean;
  readonly reason?: string;
}
