import { HashRouter } from 'react-router-dom';
import MoneyHub from './components/money/MoneyHub';

// MMM is the Money hub and nothing else — MoneyHub ships its own sidebar and
// sections, so it is the whole app. HashRouter (not BrowserRouter): the SPA is
// served by the local Express server with no fallback route, and /#/section
// URLs survive refresh without server changes.
export default function App() {
  return (
    <HashRouter>
      <MoneyHub />
    </HashRouter>
  );
}
