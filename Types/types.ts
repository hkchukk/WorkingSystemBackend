export enum Role {
  WORKER = "worker",
  EMPLOYER = "employer",
}

export type sessionUser = { id: string; role: Role };
