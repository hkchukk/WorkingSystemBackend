import type { Handler } from "@nhttp/nhttp";

export const authenticated: Handler = (rev, next) => {
  if (rev.isAuthenticated()) {
    return next();
  }
  return new Response("Unauthorized", { 
    status: 401,
    headers: {
      'Access-Control-Allow-Origin': 'http://localhost:4321/',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, platform',
    }
  }); 

};