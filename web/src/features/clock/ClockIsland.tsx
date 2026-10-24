import { useEffect, useState } from 'react';
// Same locale/options and one-second cadence as the legacy tick().
const clockText = () => {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: false }) + ' ' +
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
};
export default function ClockIsland() {
  const [text, setText] = useState(clockText);
  useEffect(() => {
    const timer = setInterval(() => setText(clockText()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{text}</>;
}
