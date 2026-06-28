import MoneyHub from './components/money/MoneyHub';

// MMM is the Money hub and nothing else — MoneyHub ships its own sidebar and
// sections, so it is the whole app (no NEXUS tab switcher / global sidebar).
export default function App() {
  return <MoneyHub />;
}
