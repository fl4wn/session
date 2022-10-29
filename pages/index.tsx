import Head from "next/head";
import Image from "next/image";
import { BiLogIn } from "react-icons/bi";

export default function Home() {
  return (
    <div>
      <Head>
        <title>Session</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="h-screen flex flex-col justify-center items-center gap-16">
        <h1 className="text-7xl text-primary">SESSION</h1>
        <div className="form-control">
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter username"
              className="input input-bordered"
            />
            <button className="btn btn-square text-xl">
              <BiLogIn />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
