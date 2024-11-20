import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid'; // For generating unique session_id
import { Input } from "@/components/ui/input";
import BotIcon from '@/components/ui/bot-icon';
import LoaderIcon from '@/components/ui/loader-icon';
import styles from './ChatInterface.module.css';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

import { PostHog } from 'posthog-node'
import GoogleMapComponent from "@/components/maps/GoogleMapsComponent";
import PlacePhotos from "@/components/maps/PlacePhotos";
import { useJsApiLoader } from '@react-google-maps/api';
let client: PostHog | undefined;
if (process.env.NEXT_PUBLIC_ENVIRONMENT === "production") {
  client = new PostHog(
    `${process.env.NEXT_PUBLIC_POSTHOG_ID}`,
    { host: 'https://app.posthog.com',
      disableGeoip: false,
      requestTimeout: 30000
    }
  );
}

type Message = {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  thinkingProcess?: {
    conversationalStage: string,
    useTools: boolean,
    tool?: string,
    toolInput?: string,
    actionOutput?: string,
    actionInput?: string
  };
};

export function ChatInterface() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // All useState hooks should be declared here, inside the component function
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [session_id] = useState(uuidv4()); // Unique session_id generated when the component mounts
  const [stream, setStream] = useState(false);
  const [botName, setBotName] = useState('');
  const [botMessageIndex, setBotMessageIndex] = useState(1);

  const [conversationalStage, setConversationalStage] = useState('');
  const [thinkingProcess, setThinkingProcess] = useState<{
    conversationalStage: string,
    tool?: string,
    toolInput?: string,
    actionOutput?: string,
    actionInput?: string
  }[]>([]);
  const [activeDay, setActiveDay] = useState<number>(0); // State for active tab
  const [itineraryData, setItineraryData] = useState<any>(null); // New state for itinerary data
  const [enhancedItineraryData, setEnhancedItineraryData] = useState<any>(null); // New state for itinerary data
  const [maxHeight, setMaxHeight] = useState('80vh'); // Default to 100% of the viewport height
  const [isBotTyping, setIsBotTyping] = useState(false);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const thinkingProcessEndRef = useRef<null | HTMLDivElement>(null);
  const [botHasResponded, setBotHasResponded] = useState(false);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    thinkingProcessEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinkingProcess]);

  useEffect(() => {
    if (botHasResponded) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      thinkingProcessEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setBotHasResponded(false); // Reset the flag
    }
  }, [botHasResponded]);

  useEffect(() => {
    // This function will be called on resize events
    const handleResize = () => {
      setMaxHeight(`${window.innerHeight - 200}px`);
    };

    // Set the initial value when the component mounts
    handleResize();

    // Add the event listener for future resize events
    window.addEventListener('resize', handleResize);

    // Return a cleanup function to remove the event listener when the component unmounts
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {

    // Function to fetch the bot name
    const fetchBotName = async () => {
      if (process.env.NEXT_PUBLIC_ENVIRONMENT === "production" && client) {
        client.capture({
          distinctId: session_id,
          event: 'fetched-bot-name',
          properties: {
            $current_url: window.location.href,
          },
        });
      }

      try {
        let response;
        const headers: Record<string, string> = {};
        if (process.env.NEXT_PUBLIC_ENVIRONMENT === "production") {
          console.log('Authorization Key:', process.env.NEXT_PUBLIC_AUTH_KEY); // Add this line
          headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_AUTH_KEY}`;
          response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/botname`, {
            headers: headers,
          });

        } else {
          response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/botname`);
        }

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.statusText}`);
        }

        const data = await response.json();
        setBotName(data.name); // Save the bot name in the state
        console.log(botName);
      } catch (error) {
        console.error("Failed to fetch the bot's name:", error);
      }
    };

    // Call the function to fetch the bot name
    fetchBotName();
  }, [botName, session_id]); // Include botName and session_id in the dependency array

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const sendMessage = () => {
    if (!inputValue.trim()) return;
    const userMessage = `${inputValue}`;
    const updatedMessages = [...messages, { id: uuidv4(), text: userMessage, sender: 'user' as 'user' }];
    setMessages(updatedMessages);
    handleBotResponse(inputValue);
    setInputValue('');
  };

  useEffect(() => {
    console.log('NEXT_PUBLIC_AUTH_KEY:', process.env.NEXT_PUBLIC_AUTH_KEY);
    console.log('NEXT_PUBLIC_ENVIRONMENT:', process.env.NEXT_PUBLIC_ENVIRONMENT);
    console.log('NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL);
  }, []);

  // Function to extract JSON from bot's response
  function extractJSON(text: string) {
    let jsonStart = text.indexOf('{');
    if (jsonStart === -1) return null;
    let jsonEnd = -1;
    let openBraces = 0;
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === '{') {
        openBraces++;
      } else if (text[i] === '}') {
        openBraces--;
        if (openBraces === 0) {
          jsonEnd = i;
          break;
        }
      }
    }
    if (jsonEnd !== -1) {
      const jsonString = text.substring(jsonStart, jsonEnd + 1);
      try {
        const json = JSON.parse(jsonString);
        const textWithoutJson = (text.substring(0, jsonStart) + ' ' + text.substring(jsonEnd + 1)).trim();
        return { json, textWithoutJson };
      } catch (e) {
        console.error('Failed to parse JSON:', e);
        return null;
      }
    }
    return null;
  }

  const handleBotResponse = async (userMessage: string) => {
    if (process.env.NEXT_PUBLIC_ENVIRONMENT === "production" && client) {
      client.capture({
        distinctId: session_id,
        event: 'sent-message',
        properties: {
          $current_url: window.location.href,
        },
      });
    }

    const requestData = {
      session_id,
      human_say: userMessage,
      stream,
    };
    setIsBotTyping(true); // Start showing the typing indicator

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (process.env.NEXT_PUBLIC_ENVIRONMENT === "production") {
        console.log('Authorization Key:', process.env.NEXT_PUBLIC_AUTH_KEY); // Add this line
        headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_AUTH_KEY}`;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/chat`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }

      if (stream) {
        {/*Not implemented*/}
      } else {
        const data = await response.json();
        console.log('Bot response:', data);
        setBotName(data.bot_name); // Update bot name based on response
        setConversationalStage(data.conversational_stage);
        // Update the thinkingProcess state with new fields from the response
        setThinkingProcess(prevProcess => [...prevProcess, {
          conversationalStage: data.conversational_stage,
          tool: data.tool,
          toolInput: data.tool_input,
          actionOutput: data.action_output,
          actionInput: data.action_input
        }]);
        let botMessageText = `${data.response}`;
        // Extract JSON from botMessageText
        const extractionResult = extractJSON(botMessageText);
        if (extractionResult) {
          const { json, textWithoutJson } = extractionResult;
          setItineraryData(json);
          setEnhancedItineraryData(data.extract_trip_json)
          botMessageText = textWithoutJson;
          setActiveDay(0); // Reset active day when new itinerary is received


        }
        const botMessage: Message = { id: uuidv4(), text: botMessageText, sender: 'bot' };
        setBotMessageIndex(botMessageIndex + 1);
        setMessages((prevMessages) => [...prevMessages, botMessage]);
      }
    } catch (error) {
      console.error("Failed to fetch bot's response:", error);
    } finally {
      setIsBotTyping(false); // Stop showing the typing indicator
      setBotHasResponded(true);
    }
  };
  return (
    <div key="1" className="flex flex-col " style={{ height: '89vh' }}>
      <header className="flex items-center justify-center h-16 bg-gray-900 text-white">
        <BotIcon className="animate-wave h-7 w-6 mr-2" />
        <h1 className="text-2xl font-bold">Liknoss AI Travel Agent</h1>
      </header>
      <main className="flex flex-row justify-center items-start bg-gray-100 dark:bg-gray-900 p-4" >
        <div className="flex flex-col w-1/2 h-full bg-white rounded-lg shadow-md p-4 mr-4 chat-messages" style={{maxHeight}}>
          <div className="flex items-center mb-4">
            <BotIcon className="h-6 w-6 text-gray-500 mr-2" />
            <h2 className="text-lg font-semibold">Chat Interface With The Customer</h2>
          </div>
          <div className={`flex-1 overflow-y-auto ${styles.hideScrollbar}`}>
        {messages.map((message, index) => (
    <div key={message.id} className="flex items-center p-2">
      {message.sender === 'user' ? (
        <>
          <span role="img" aria-label="User" className="mr-2">👤</span>
          <span className={`text-frame p-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-900`}>
            {message.text}
          </span>
        </>
      ) : (

        <div className="flex w-full justify-between">
          <div className="flex items-center">
            <img
              alt="Bot"
              className="rounded-full mr-2"
              src="/maskot.png"
              style={{ width: 24, height: 24, objectFit: "cover" }}
            />
            <span className={`text-frame p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-900`}>
            <ReactMarkdown rehypePlugins={[rehypeRaw]} components={{
              a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" />
            }}>
              {message.text}
            </ReactMarkdown>
            </span>
          </div>
          {message.sender === 'bot' && (
            <div className="flex items-center justify-end ml-2">
              {/* Style the index similar to the thinking process and position it near the border */}
              <div className="text-sm text-gray-500" style={{minWidth: '20px', textAlign: 'right'}}>
                <strong>({messages.filter((m, i) => m.sender === 'bot' && i <= index).length})</strong>
              </div>
            </div>
          )}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  ))}
    {isBotTyping && (
      <div className="flex items-center justify-start">
        <img alt="Bot" className="rounded-full mr-2" src="/maskot.png" style={{ width: 24, height: 24, objectFit: "cover" }} />
        <div className={`${styles.typingBubble}`}>
        <span className={`${styles.typingDot}`}></span>
        <span className={`${styles.typingDot}`}></span>
        <span className={`${styles.typingDot}`}></span>
      </div>
      </div>
    )}
          </div>
          <div className="mt-4">
            <Input
              className="w-full"
              placeholder="Type your message..."
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendMessage();
                }
              }}
            />
          </div>
        </div>
        <div className="flex flex-col w-1/2 h-full bg-white rounded-lg shadow-md p-4 thinking-process" style={{maxHeight}}>
  <div className="flex items-center mb-4">
    <BotIcon className="h-6 w-6 text-gray-500 mr-2" />
    <h2 className="text-lg font-semibold">AI Travel Agent {botName} Map </h2>
  </div>
  <div className={`flex-1 overflow-y-auto hide-scroll ${styles.hideScrollbar}`} style={{ overflowX: 'hidden' }}>

    {itineraryData ? (
        <>
          <PlacePhotos
              apiKey={apiKey}
              location={`${itineraryData.location_name}, ${itineraryData.location_country}`}
          />
          <GoogleMapComponent
              apiKey={apiKey}
              location={`${itineraryData.location_name}, ${itineraryData.location_country}`}
          />
        </>
        ) : (
          <GoogleMapComponent apiKey={apiKey} />
        )}
    <div>
       {itineraryData ? (
        <div>
          {/* Display Title and Location Info */}
          <div className="p-6 bg-white shadow-md rounded-lg mb-6">
  <h2 className="text-2xl font-bold text-gray-800 mb-2 border-b pb-2">{itineraryData.title}</h2>
  <div className="text-base text-gray-700 mb-4">
    <p className="mb-1">
      <span className="font-semibold">Location:</span> {itineraryData.location_name}, {itineraryData.location_country}
    </p>
    <p className="mb-1">
      <span className="font-semibold">Suggested Hotel:</span> {itineraryData.suggested_hotel}
    </p>
    <p>
      <span className="font-semibold">Trip Overview:</span> {itineraryData.trip_overview}
    </p>
  </div>
          </div>


          {/* Tabs for Each Day */}
          <div className="flex border-b mb-4">
            {itineraryData.itinerary && itineraryData.itinerary.map((_: any, index: number) => (
                <button
                    key={index}
                    className={`px-4 py-2 -mb-px border-b-2 ${
                        activeDay === index ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-500'
                    }`}
                    onClick={() => setActiveDay(index)}
                >
                  Day {index + 1}
                </button>
            ))}
          </div>

          {/* Display Activities for Active Day */}
          {itineraryData.itinerary && itineraryData.itinerary[activeDay] && (
  <div className="my-4 border-l-2 border-gray-300 pl-6">
    <h3 className="text-lg font-semibold mb-2">Day {itineraryData.itinerary[activeDay].day_number}</h3>
    <div className="flex flex-col space-y-4">
      {enhancedItineraryData.itinerary[activeDay].morning_activities && (
        <div className="relative ml-4">
          <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-blue-500"></div>
          <div className="text-sm">
            <strong className="block">Morning Activities:</strong>
            <p>{enhancedItineraryData.itinerary[activeDay].morning_activities}</p>
          </div>
        </div>
      )}
      {enhancedItineraryData.itinerary[activeDay].afternoon_details && (
        <div className="relative ml-4">
          <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-green-500"></div>
          <div className="text-sm">
            <strong className="block">Afternoon Details:</strong>
            <p>{enhancedItineraryData.itinerary[activeDay].afternoon_details}</p>
          </div>
        </div>
      )}
      {enhancedItineraryData.itinerary[activeDay].evening_plans && (
        <div className="relative ml-4">
          <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="text-sm">
            <strong className="block">Evening Plans:</strong>
            <p>{enhancedItineraryData.itinerary[activeDay].evening_plans}</p>
          </div>
        </div>
      )}
    </div>
  </div>
)}

        </div>
      ) : (
        <div>

        </div>
      )}
    </div>
    <div ref={thinkingProcessEndRef} />
</div></div>
      </main>
    </div>
  );
}
