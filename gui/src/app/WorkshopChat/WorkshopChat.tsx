import { Hyperlink, SmallIconButton } from "@fi-sci/misc";
import {
  Cancel,
  Close,
  Help,
  QuestionMarkSharp,
  Settings,
} from "@mui/icons-material";
import { timeAgoString } from "app/timeStrings";
import {
  generateKeyPair,
  EphemeriChatClient,
  isValidKeyPair,
  userIdFromPublicKey,
} from "EphemeriChatClient/EphemeriChatClient";
import { ChatMessage } from "EphemeriChatClient/types";
import {
  FunctionComponent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

type WorkshopChatProps = {
  width: number;
  height: number;
  onClose: () => void;
};

const channelName = "neurosift.workshop";

type ChatComment = {
  commentId: string;
  senderPublicKey: string;
  userName: string;
  timestamp: number;
  comment: string;
  chatMessage: ChatMessage;
};

type ChatCommentAction =
  | {
      type: "add";
      commentChatMessage: ChatMessage;
    }
  | {
      type: "addMultiple";
      commentChatMessages: ChatMessage[];
    }
  | {
      type: "clear";
    };

const expireTimeMsec = 1000 * 60 * 60 * 1; // 1 hour

const chatCommentsReducer = (
  state: ChatComment[],
  action: ChatCommentAction,
): ChatComment[] => {
  switch (action.type) {
    case "add": {
      const m = action.commentChatMessage;

      // Do not add messages that have expired
      if (m.timestamp < Date.now() - expireTimeMsec) return state;

      const msg = JSON.parse(m.messageJson);
      const comment: ChatComment = {
        commentId: m.systemSignature,
        senderPublicKey: m.senderPublicKey,
        userName: msg.userName,
        timestamp: m.timestamp,
        comment: msg.comment,
        chatMessage: m,
      };
      const existing = state.find((c) => c.commentId === comment.commentId);
      if (existing) return state;
      return [...state, comment].sort((a, b) => a.timestamp - b.timestamp);
    }
    case "addMultiple": {
      let s = state;
      for (const m of action.commentChatMessages) {
        s = chatCommentsReducer(s, { type: "add", commentChatMessage: m });
      }
      return s;
    }
    case "clear":
      return [];
    default:
      return state;
  }
};

const WorkshopChat: FunctionComponent<WorkshopChatProps> = ({
  width,
  height,
  onClose,
}) => {
  const inputBarHeight = 30;
  const settingsBarHeight = 20;
  const topBarHeight = 20;

  const [chatComments, chatCommentsDispatch] = useReducer(
    chatCommentsReducer,
    [],
  );
  const [userName, setUserName] = useState(
    localStorage.getItem("workshop-chat-user-name") || "Anonymous",
  );
  const ephemeriChatClient = useEphemeriChatClient();
  useEffect(() => {
    if (!ephemeriChatClient) return;
    const handleCommentMessage = (m: ChatMessage) => {
      chatCommentsDispatch({ type: "add", commentChatMessage: m });
    };
    ephemeriChatClient.onMessage((m: ChatMessage) => {
      const msg = JSON.parse(m.messageJson);
      if (msg.type === "comment") {
        handleCommentMessage(m);
      } else if (msg.type === "request-history") {
        const startTimestamp = msg.startTimestamp;
        // send in batches
        let i = 0;
        while (i < chatComments.length) {
          let size0 = 0;
          const toSend: ChatMessage[] = [];
          while (size0 < 10000 && i < chatComments.length) {
            const mm = chatComments[i].chatMessage;
            if (mm.timestamp > startTimestamp) {
              toSend.push(mm);
              size0 += JSON.stringify(mm).length;
            }
            i++;
          }
          if (toSend.length > 0) {
            console.log(`Sending history of size ${toSend.length}`);
            ephemeriChatClient.publish(channelName, {
              type: "history",
              comments: toSend,
            });
          }
        }
      } else if (msg.type === "history") {
        msg.comments.forEach((c: ChatMessage) => {
          const ttt = getCaughtUpTimestamp();
          if (c.timestamp < ttt) {
            // don't accept history messages that come before the caught up timestamp
            return;
          }
          handleCommentMessage(c);
        });
      }
    });
  }, [ephemeriChatClient, chatComments]);

  // just to be careful that we never send a request-history message repeatedly
  const initialLoadComplete = useRef(false);
  const hasSentRequestHistory = useRef(false);
  useEffect(() => {
    if (!ephemeriChatClient) return;
    let canceled = false;
    (async () => {
      try {
        const commentChatMessages =
          await loadCommentChatMessagesFromIndexedDB();
        if (canceled) return;
        chatCommentsDispatch({ type: "addMultiple", commentChatMessages });
      } catch (e) {
        console.error(e);
      }
      if (!hasSentRequestHistory.current) {
        const startTimestamp = getCaughtUpTimestamp();
        console.log("Requesting history", startTimestamp);
        ephemeriChatClient.publish(channelName, {
          type: "request-history",
          startTimestamp,
        });
        hasSentRequestHistory.current = true;
      }
      initialLoadComplete.current = true;
    })();
    return () => {
      canceled = true;
    };
  }, [ephemeriChatClient]);

  useEffect(() => {
    if (!initialLoadComplete.current) return;
    for (const c of chatComments) {
      if (c.timestamp > getCaughtUpTimestamp()) {
        setCaughtUpTimestamp(c.timestamp);
      }
    }
    saveCommentChatMessagesToIndexedDB(chatComments.map((c) => c.chatMessage));
  }, [chatComments]);

  const handleComment = useCallback(
    (comment: string) => {
      if (!ephemeriChatClient) return;
      ephemeriChatClient.publish(channelName, {
        type: "comment",
        userName,
        comment,
      });
    },
    [ephemeriChatClient, userName],
  );

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastCommentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastCommentRef.current) {
      lastCommentRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatComments, ephemeriChatClient]);

  const handleClearAllComments = useCallback(() => {
    indexedDB.deleteDatabase("workshop-chat");
    setCaughtUpTimestamp(Date.now());
    chatCommentsDispatch({ type: "clear" });
  }, []);

  return (
    <div style={{ position: "absolute", width, height }}>
      <div
        style={{
          position: "absolute",
          width,
          height: topBarHeight,
          top: 0,
          left: 0,
          background: "gray",
          color: "white",
          fontSize: 12,
        }}
      >
        Workshop chat (ephemeral){" "}
        <SmallIconButton
          icon={<Help />}
          title="Learn more about the workshop chat"
          fontSize={14}
          onClick={() => {
            const url =
              "https://gist.github.com/magland/7483a6bf2259babeaa06a1aa253821ad#file-neurosift_workshop_chat_info-md";
            window.open(url, "_blank");
          }}
        />
      </div>
      <div
        className="close-button"
        style={{
          position: "absolute",
          width: topBarHeight,
          height: topBarHeight,
          top: -3,
          left: width - topBarHeight,
        }}
      >
        <SmallIconButton icon={<Close />} onClick={onClose} />
      </div>
      <div
        ref={chatContainerRef}
        style={{
          position: "absolute",
          width,
          top: topBarHeight,
          height: height - topBarHeight - inputBarHeight - settingsBarHeight,
          overflow: "auto",
        }}
      >
        {chatComments.map((c, index) => (
          <div
            key={c.commentId}
            ref={index === chatComments.length - 1 ? lastCommentRef : null}
            style={{
              color: colorForString(userIdFromPublicKey(c.senderPublicKey)),
            }}
          >
            <hr />
            <span>{c.userName}: </span>
            <span style={{ color: "black" }}>
              <CommentDisplay comment={c.comment} />
            </span>
            <span style={{ fontSize: 10, color: "gray" }}>
              <br />
              {timeAgoString(c.timestamp / 1000)}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          width,
          height: inputBarHeight,
          top: height - inputBarHeight - settingsBarHeight,
          left: 0,
        }}
      >
        {ephemeriChatClient ? (
          <InputBar
            width={width}
            height={inputBarHeight}
            onComment={handleComment}
          />
        ) : (
          <span>Connecting...</span>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          width,
          height: settingsBarHeight,
          top: height - settingsBarHeight,
          left: 0,
        }}
      >
        <SettingsBar
          width={width}
          height={settingsBarHeight}
          userName={userName}
          setUserName={setUserName}
          onClearAllComments={handleClearAllComments}
        />
      </div>
    </div>
  );
};

const useEphemeriChatClient = () => {
  const [ephemeriChatClient, setEphemeriChatClient] =
    useState<EphemeriChatClient | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const { publicKey, privateKey } = await getPersistentKeyPair();
      if (canceled) return;
      const x = new EphemeriChatClient(publicKey, privateKey, {
        verbose: true,
      });
      await x.subscribeToChannels([channelName]);
      setEphemeriChatClient(x);
    })();
    return () => {
      canceled = true;
    };
  }, []);
  return ephemeriChatClient;
};

const getPersistentKeyPair = async () => {
  const publicKey = localStorage.getItem("workshop-chat-public-key");
  const privateKey = localStorage.getItem("workshop-chat-private-key");
  if (publicKey && privateKey) {
    const isValid = await isValidKeyPair(publicKey, privateKey);
    if (isValid) {
      return { publicKey, privateKey };
    } else {
      console.warn("Invalid key pair in local storage");
    }
  }
  const kp = await generateKeyPair();
  localStorage.setItem("workshop-chat-public-key", kp.publicKey);
  localStorage.setItem("workshop-chat-private-key", kp.privateKey);
  return kp;
};

type InputBarProps = {
  width: number;
  height: number;
  onComment: (comment: string) => void;
};

const InputBar: FunctionComponent<InputBarProps> = ({
  width,
  height,
  onComment,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const commentString = e.currentTarget.value.trim();
        if (commentString.length > 1000) {
          alert("Comment is too long");
          return;
        }
        onComment(commentString);
        e.currentTarget.value = "";
      }
    },
    [onComment],
  );
  return (
    <div style={{ position: "absolute", width, height }}>
      <input
        style={{ width: width - 8, height: height - 7 }}
        onKeyDown={handleKeyDown}
        placeholder="Type a comment..."
      />
    </div>
  );
};

type SettingsBarProps = {
  width: number;
  height: number;
  userName: string;
  setUserName: (userName: string) => void;
  onClearAllComments: () => void;
};

const SettingsBar: FunctionComponent<SettingsBarProps> = ({
  width,
  height,
  userName,
  setUserName,
  onClearAllComments,
}) => {
  const [advancedSettingsVisible, setAdvancedSettingsVisible] = useState(false);
  return (
    <span style={{ fontSize: 12, padding: 5 }}>
      <Hyperlink
        onClick={() => {
          const newUserName = prompt("Enter a user name", userName);
          if (newUserName) {
            setUserName(newUserName);
            localStorage.setItem("workshop-chat-user-name", newUserName);
          }
        }}
      >
        Commenting as {userName}
      </Hyperlink>
      &nbsp;&nbsp;&nbsp;&nbsp;
      {
        <SmallIconButton
          icon={<Settings />}
          title="Open advanced settings"
          onClick={() => setAdvancedSettingsVisible((v) => !v)}
        />
      }
      {advancedSettingsVisible && (
        <>
          &nbsp;&nbsp;&nbsp;
          <SmallIconButton
            icon={<Cancel />}
            onClick={() => {
              if (confirm("Clear all comments?")) {
                onClearAllComments();
              }
            }}
            title="Clear all comments"
          />
        </>
      )}
    </span>
  );
};

const colorForString = (s: string) => {
  // s is a random user ID, we need to derive a color from it
  // This is a simple way to do it
  const hash = s.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const r = hash % 200;
  const g = (hash * 2) % 200;
  const b = (hash * 3) % 200;
  return `rgb(${r},${g},${b})`;
};

type CommentDisplayProps = {
  comment: string;
};

const CommentDisplay: FunctionComponent<CommentDisplayProps> = ({
  comment,
}) => {
  // turn URLs into hyperlinks
  const parts = comment.split(" ");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? " " : ""}
          {part.startsWith("http://") || part.startsWith("https://") ? (
            <a href={part} target="_blank" rel="noreferrer">
              {part}
            </a>
          ) : (
            part
          )}
        </span>
      ))}
    </>
  );
};

const openDatabase = async () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("workshop-chat", 1);
    request.onupgradeneeded = (e) => {
      const db = (e.target as any).result;
      db.createObjectStore("chatMessages", {
        keyPath: "systemSignature",
      }).createIndex("channelName", "channelName");
    };
    request.onsuccess = (e) => {
      resolve((e.target as any).result);
    };
    request.onerror = (e) => {
      reject(e);
    };
  });
};

const saveCommentChatMessagesToIndexedDB = async (messages: ChatMessage[]) => {
  const db = await openDatabase();
  const tx = db.transaction("chatMessages", "readwrite");
  const store = tx.objectStore("chatMessages");
  for (const m of messages) {
    store.put(m);
  }
  await new Promise((resolve) => {
    tx.oncomplete = resolve;
  });
};

const loadCommentChatMessagesFromIndexedDB = async (): Promise<
  ChatMessage[]
> => {
  const db = await openDatabase();
  const tx = db.transaction("chatMessages", "readonly");
  const store = tx.objectStore("chatMessages");
  const messages: ChatMessage[] = [];
  const cursor = store.openCursor();
  await new Promise<void>((resolve, reject) => {
    cursor.onsuccess = (e) => {
      const c = (e.target as any).result;
      if (c) {
        messages.push(c.value);
        c.continue();
      } else {
        resolve();
      }
    };
    cursor.onerror = (e) => {
      reject(e);
    };
  });
  return messages;
};

const getCaughtUpTimestamp = (): number => {
  try {
    const a = localStorage.getItem("workshop-chat-caught-up-timestamp");
    if (a) {
      return parseInt(a);
    } else {
      return Date.now() - 1000 * 60 * 60 * 24; // 1 day ago
    }
  } catch (e) {
    return Date.now() - 1000 * 60 * 60 * 24; // 1 day ago
  }
};

const setCaughtUpTimestamp = (timestamp: number) => {
  localStorage.setItem(
    "workshop-chat-caught-up-timestamp",
    timestamp.toString(),
  );
};

export default WorkshopChat;
