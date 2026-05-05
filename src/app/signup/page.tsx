import { redirect } from "next/navigation";

// /signup is a friendly alias to /login (the form supports both modes).
export default function SignupPage() {
  redirect("/login");
}
