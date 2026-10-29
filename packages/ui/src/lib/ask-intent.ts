// "Comment & ask agent" submits through the same onSubmit callbacks as a plain
// comment. The intent is set only for the duration of that synchronous call, and the
// create-thread/reply request it fires reads it, so the flag never outlives the click.
let askDuringSubmit = false;

export function submitWithAsk(submit: () => void): void {
  askDuringSubmit = true;
  try {
    submit();
  } finally {
    askDuringSubmit = false;
  }
}

export function isAskingDuringSubmit(): boolean {
  return askDuringSubmit;
}
