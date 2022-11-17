import React, { useEffect, useRef, useState } from "react";
import CamFrame from "../../components/CamFrame";
import { IoCallOutline } from "react-icons/io5";
import {
  BsCameraVideo,
  BsCameraVideoOff,
  BsVolumeUp,
  BsVolumeMute,
  BsClipboard,
} from "react-icons/bs";
import Link from "next/link";
import Head from "next/head";
import Navbar from "../../components/Navbar";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import { useRouter } from "next/router";
import { Database } from "../../types/supabase";

const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

interface IPeerMeta {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isConnected: boolean;
}

export default function Session() {
  const supabase = useSupabaseClient<Database>();
  const router = useRouter();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const localStreamRef = useRef<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const remoteStreamRef = useRef<MediaStream>();
  const [copyTooltip, setCopyTooltip] = useState("Copy session link");
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [localName, setLocalName] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const candidates = useRef<RTCIceCandidate[]>([]);
  const dcAudio = useRef<HTMLAudioElement>();
  const [remoteMeta, setRemoteMeta] = useState<IPeerMeta>({
    isAudioEnabled: true,
    isVideoEnabled: true,
    isConnected: true,
  });
  const pc = useRef<RTCPeerConnection>();
  const dataChannel = useRef<RTCDataChannel>();

  const handleToggleAudio = () => {
    if (!localStream) return;
    setIsAudioEnabled((prev) => {
      localStream.getAudioTracks()[0].enabled = !prev;
      dataChannel.current?.send(
        JSON.stringify({
          isAudioEnabled: !prev,
          isVideoEnabled,
          isConnected: true,
        })
      );
      return !prev;
    });
  };

  const handleToggleVideo = () => {
    if (!localStream) return;
    setIsVideoEnabled((prev) => {
      localStream.getVideoTracks()[0].enabled = !prev;
      dataChannel.current?.send(
        JSON.stringify({
          isAudioEnabled,
          isVideoEnabled: !prev,
          isConnected: true,
        })
      );
      return !prev;
    });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopyTooltip("Copied!");
    setTimeout(() => setCopyTooltip("Copy session link"), 1000);
  };

  useEffect(() => {
    //Initialize peer connection
    pc.current = new RTCPeerConnection(servers);

    //Event handlers
    const handleOnDataChannel = (ev: RTCDataChannelEvent) => {
      dataChannel.current = ev.channel;
      dataChannel.current.addEventListener("message", handleOnMessage);
    };

    const handleOnMessage = (ev: MessageEvent) => {
      const data: IPeerMeta = JSON.parse(ev.data);
      if (!data.isConnected) router.push("/");
      setRemoteMeta(data);
      console.log(data);
    };

    const handleOnTrack = (ev: RTCTrackEvent) => {
      setRemoteStream(ev.streams[0]);
      remoteStreamRef.current = ev.streams[0];
    };

    const handleOnIceCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) return;
      candidates.current?.push(ev.candidate);
    };

    const handleOnIceOffer = async () => {
      if (pc.current?.iceGatheringState === "complete") {
        await supabase
          .from("sessions")
          .update({ offer_ice: JSON.stringify(candidates.current) })
          .eq("session_id", router.query.id);
      }
    };

    const handleOnIceAnswer = async () => {
      if (pc.current?.iceGatheringState === "complete") {
        await supabase
          .from("sessions")
          .update({ answer_ice: JSON.stringify(candidates.current) })
          .eq("session_id", router.query.id);
      }
    };

    const handleOnDisconnect = () => {
      if (
        pc.current?.connectionState === "closed" ||
        pc.current?.connectionState === "disconnected" ||
        pc.current?.connectionState === "failed"
      ) {
        router.push("/");
      }
    };

    const initSession = async () => {
      if (!router.query.id) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(stream);
      localStreamRef.current = stream;

      //Push tracks to connection
      stream
        .getTracks()
        .forEach((track) => pc.current?.addTrack(track, stream));
      //Set remote tracks
      pc.current?.addEventListener("track", handleOnTrack);
      //Remove tracks on disconnect
      pc.current?.addEventListener("connectionstatechange", handleOnDisconnect);
      //Listen for data channel
      pc.current?.addEventListener("datachannel", handleOnDataChannel);

      const { data, error } = await supabase
        .from("sessions")
        .select()
        .eq("session_id", router.query.id)
        .single();

      if (error) return;

      //If user is caller
      if (data.caller_name === localStorage.getItem("username")) {
        //Initialize data channel
        dataChannel.current = pc.current?.createDataChannel("peer_meta");
        dataChannel.current?.addEventListener("message", handleOnMessage);

        pc.current?.addEventListener("icecandidate", handleOnIceCandidate);
        pc.current?.addEventListener(
          "icegatheringstatechange",
          handleOnIceOffer
        );
        const offerDescription = await pc.current?.createOffer();
        await pc.current?.setLocalDescription(offerDescription);

        await supabase
          .from("sessions")
          .update({ offer_sdp: offerDescription })
          .eq("session_id", data.session_id);

        supabase
          .channel("public:sessions")
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "sessions",
              filter: `session_id=eq.${data.session_id}`,
            },
            (payload) => {
              //Set remote name
              setRemoteName(payload.new.receiver_name);

              if (payload.new.answer_sdp) {
                const answerDescription = new RTCSessionDescription(
                  payload.new.answer_sdp
                );
                pc.current?.setRemoteDescription(answerDescription);
              } else if (payload.new.answer_ice) {
                const answer_ice: RTCIceCandidate[] = JSON.parse(
                  payload.new.answer_ice
                );
                answer_ice.forEach((candidate) => {
                  pc.current?.addIceCandidate(candidate);
                });
              }
            }
          )
          .subscribe();
      }
      //If user is receiver
      else {
        //Set remote name
        setRemoteName(data.caller_name || "");
        pc.current?.addEventListener("datachannel", handleOnDataChannel);
        pc.current?.addEventListener("icecandidate", handleOnIceCandidate);
        pc.current?.addEventListener(
          "icegatheringstatechange",
          handleOnIceAnswer
        );
        const offerDescription = new RTCSessionDescription(data.offer_sdp);
        await pc.current?.setRemoteDescription(offerDescription);

        const answerDescription = await pc.current?.createAnswer();
        await pc.current?.setLocalDescription(answerDescription);

        await supabase
          .from("sessions")
          .update({
            answer_sdp: answerDescription,
            receiver_name: localStorage.getItem("username"),
          })
          .eq("session_id", data.session_id);

        supabase
          .channel("public:sessions")
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "sessions",
              filter: `session_id=eq.${data.session_id}`,
            },
            (payload) => {
              if (payload.new.offer_ice) {
                const offer_ice: RTCIceCandidate[] = JSON.parse(
                  payload.new.offer_ice
                );
                offer_ice.forEach((candidate) => {
                  pc.current?.addIceCandidate(candidate);
                });
              }
            }
          )
          .subscribe();
      }
    };

    setLocalName(localStorage.getItem("username") || "");
    dcAudio.current = new Audio("/assets/disconnect.mp3");
    initSession();

    //Cleanup
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      pc.current?.removeEventListener("icecandidate", handleOnIceCandidate);
      pc.current?.removeEventListener(
        "icegatheringstatechange",
        handleOnIceOffer
      );
      pc.current?.removeEventListener(
        "icegatheringstatechange",
        handleOnIceAnswer
      );
      pc.current?.removeEventListener("track", handleOnTrack);
      pc.current?.removeEventListener(
        "connectionstatechange",
        handleOnDisconnect
      );
      pc.current?.removeEventListener("datachannel", handleOnDataChannel);
      dataChannel.current?.removeEventListener("message", handleOnMessage);

      if (dataChannel.current?.readyState === "open") {
        dataChannel.current?.send(
          JSON.stringify({ isAudioEnabled, isVideoEnabled, isConnected: false })
        );
      }

      dataChannel.current?.close();
      pc.current?.close();
      dcAudio.current?.play();
    };
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <title>Session</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Navbar />

      <main className="flex-1 flex flex-col items-center justify-center gap-16">
        <ul className="flex justify-center items-center flex-wrap gap-4">
          {localStream ? (
            <CamFrame
              username={localName}
              stream={localStream}
              isAudioEnabled={isAudioEnabled}
              isVideoEnabled={isVideoEnabled}
              local
            />
          ) : (
            <img src="/loading.svg" alt="loading" />
          )}
          {remoteStream && (
            <CamFrame
              username={remoteName}
              stream={remoteStream}
              isAudioEnabled={remoteMeta.isAudioEnabled}
              isVideoEnabled={remoteMeta.isVideoEnabled}
            />
          )}
        </ul>
        <ul className="fixed bottom-4 flex justify-center items-center gap-4 bg-base-100 border border-neutral py-4 px-8 rounded-xl z-20 shadow-lg">
          <li className="tooltip" data-tip={copyTooltip}>
            <button
              onClick={handleCopy}
              className="text-xl p-2 rounded-full hover:text-secondary"
            >
              <BsClipboard />
            </button>
          </li>
          <li
            className="tooltip"
            data-tip={isVideoEnabled ? "Disable camera" : "Enable camera"}
          >
            <button
              onClick={handleToggleVideo}
              className="text-xl p-2 rounded-full hover:text-secondary"
            >
              {isVideoEnabled ? <BsCameraVideo /> : <BsCameraVideoOff />}
            </button>
          </li>
          <li
            className="tooltip"
            data-tip={
              isAudioEnabled ? "Disable microphone" : "Enable microphone"
            }
          >
            <button
              onClick={handleToggleAudio}
              className="text-xl p-2 rounded-full hover:text-secondary"
            >
              {isAudioEnabled ? <BsVolumeUp /> : <BsVolumeMute />}
            </button>
          </li>
          <li className="tooltip" data-tip="Leave session">
            <Link href="/">
              <div className="text-xl p-2 rounded-full border border-primary text-primary hover:bg-primary hover:text-base-100">
                <IoCallOutline />
              </div>
            </Link>
          </li>
        </ul>
      </main>
    </div>
  );
}
