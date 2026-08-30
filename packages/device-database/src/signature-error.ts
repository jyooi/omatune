export class ItunesdbSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItunesdbSignatureError";
  }
}
