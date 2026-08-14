/**
 * @porcupine/shared — types and schemas used by both the web app and the
 * collaboration relay. Nothing here may import Prisma, React, or anything
 * runtime-specific: the relay runs on workerd, the app runs on Node.
 */
export * from "./capabilities";
export * from "./relay-ticket";
export * from "./screening";
