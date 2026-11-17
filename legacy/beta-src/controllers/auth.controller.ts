import {
  registerUser,
  loginUser,
  getCurrentUser
} from "../services/auth.service.js";

export async function registerController(
  req: any,
  res: any
) {
  try {
    const result =
      await registerUser(
        req.body
      );

    return res.json(
      result
    );

  } catch (error: any) {
    console.error(error);

    if (
      error.message ===
      "Email already exists"
    ) {
      return res.status(400).json({
        error:
          "Email já está em uso"
      });
    }

    return res.status(500).json({
      error:
        "Erro ao registrar"
    });
  }
}

export async function loginController(
  req: any,
  res: any
) {
  try {
    const result =
      await loginUser(
        req.body
      );

    return res.json(
      result
    );

  } catch (error: any) {
    console.error(error);

    if (
      error.message ===
      "User not found"
    ) {
      return res.status(400).json({
        error:
          "Usuário não encontrado"
      });
    }

    if (
      error.message ===
      "Invalid password"
    ) {
      return res.status(400).json({
        error:
          "Senha inválida"
      });
    }

    return res.status(500).json({
      error:
        "Erro no login"
    });
  }
}

export async function meController(
  req: any,
  res: any
) {
  try {
    const user =
      await getCurrentUser(
        req.user.userId
      );

    return res.json(
      user
    );

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to fetch user"
    });
  }
}