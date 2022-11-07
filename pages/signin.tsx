import Head from "next/head";
import Navbar from "../components/Navbar";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import { Auth, ThemeSupa } from "@supabase/auth-ui-react";

export default function SignIn() {
  const supabase = useSupabaseClient();

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <title>Session</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto flex flex-col lg:flex-row justify-center items-center gap-16 p-4">
        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: "purple",
                  brandAccent: "black",
                },
              },
            },
          }}
          theme="dark"
          redirectTo={window.location.origin}
        />
      </main>
    </div>
  );
}