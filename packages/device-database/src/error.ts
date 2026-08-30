export class ItunesdbParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "ItunesdbParseError";
    this.offset = offset;
  }
}
