import { z } from "zod";

const email = z.email().trim().toLowerCase();
// bcrypt only uses the first 72 bytes, so longer passwords are rejected
// instead of being silently cut short.
export const password = z.string().min(8, "Password must be at least 8 characters").max(72);

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

// Admin-only: create a user with any role.
export const createUserSchema = signupSchema.extend({
  role: z.enum(["ADMIN", "MENTOR", "STUDENT", "RECRUITER"]),
  phone: z.string().trim().max(20).optional(),
  company: z.string().trim().min(2).max(120).optional(), // recruiters
}).refine((u) => u.role !== "RECRUITER" || !!u.company, { message: "Add the recruiter's company", path: ["company"] });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: password,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
