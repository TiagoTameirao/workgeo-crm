import { sleep } from "workflow";

export async function agendaNotification(id, dueAt) {
  "use workflow";
  await sleep(new Date(dueAt));
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await deliver(id);
    if (result !== "tentar novamente") return result;
    await sleep("5m");
  }
}
async function deliver(id) {
  "use step";
  const { deliverNotification } = await import("../lib/notifications.mjs");
  return deliverNotification(id);
}
