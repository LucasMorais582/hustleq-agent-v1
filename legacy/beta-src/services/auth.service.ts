import bcrypt from "bcrypt";

import { prisma }
from "../lib/prisma.js";

import {
  generateToken
} from "../lib/auth.js";

export async function registerUser(
  data: any
) {
  const {
    name,
    email,
    password
  } = data;

  const existingUser =
    await prisma.user.findUnique({
      where: { email },
    });

  if (existingUser) {
    throw new Error(
      "Email already exists"
    );
  }

  const hashedPassword =
    await bcrypt.hash(
      password,
      10
    );

  const user =
    await prisma.user.create({
      data: {
        name,
        email,
        password:
          hashedPassword,
      },
    });

  const token =
    generateToken(
      user.id
    );

  return {
    token,
    user,
  };
}

export async function loginUser(
  data: any
) {
  const {
    email,
    password
  } = data;

  const user =
    await prisma.user.findUnique({
      where: { email },
    });

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  const valid =
    await bcrypt.compare(
      password,
      user.password
    );

  if (!valid) {
    throw new Error(
      "Invalid password"
    );
  }

  const token =
    generateToken(
      user.id
    );

  return {
    token,
    user,
  };
}

export async function getCurrentUser(
  userId: string
) {
  const user =
    await prisma.user.findUnique({
      where: {
        id: userId
      },

      select: {
        id: true,
        email: true,
      },
    });

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  return user;
}