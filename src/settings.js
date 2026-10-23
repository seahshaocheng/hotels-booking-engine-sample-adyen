// Demo-wide settings changed from the on-page settings drawer. Held in memory,
// so they reset to these defaults whenever the server restarts.

const settings = {
  // Adyen payment method types (tx variants) hidden from the Drop-in.
  blockedPaymentMethods: [],
  // When false, members can't save cards and every session uses
  // shopperReference "not_provided" (only the OPI trans token is collected).
  memberCardsEnabled: true,
};

function getSettings() {
  return { ...settings, blockedPaymentMethods: [...settings.blockedPaymentMethods] };
}

function setBlockedPaymentMethods(types) {
  settings.blockedPaymentMethods = [...new Set(types)];
}

function setMemberCardsEnabled(enabled) {
  settings.memberCardsEnabled = enabled;
}

module.exports = { getSettings, setBlockedPaymentMethods, setMemberCardsEnabled };
