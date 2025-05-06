export enum Role {
  WORKER = "worker",
  EMPLOYER = "employer",
  ADMIN = "admin",
}

export type sessionUser = { id: string; role: Role };
