
export class AlreadyEnrolledException extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlreadyEnrolledException';
    Object.setPrototypeOf(this, AlreadyEnrolledException.prototype);

  }
}
