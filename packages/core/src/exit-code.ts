export const ExitCode = {
  Success: 0,
  RefusedBeforeChange: 1,
  StoppedAfterChange: 2,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]
