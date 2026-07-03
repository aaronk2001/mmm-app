// Which settings each dashboard widget supports. Consumed by WidgetSettingsPopover.
export const WIDGET_SETTINGS = {
  netWorthTrend:      [{ key: 'timeframe', type: 'timeframe', label: 'Timeframe' }],
  budgets:            [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'categories', type: 'categories', label: 'Categories' }],
  goals:              [{ key: 'count', type: 'count', label: 'Rows' }],
  accounts:           [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'accounts', type: 'accounts', label: 'Accounts' }],
  recentTransactions: [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'categories', type: 'categories', label: 'Categories' }, { key: 'accounts', type: 'accounts', label: 'Accounts' }],
};

export const TIMEFRAMES = [{ id: '30d', label: '30d' }, { id: '90d', label: '90d' }, { id: 'all', label: 'All' }];
