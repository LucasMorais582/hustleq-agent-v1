import { verifyToken } from "../lib/auth.js";

export function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyToken(token);

    req.user = decoded; // { userId }

    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}