let whatsappClient;

const setWhatsAppClient = (client) => {
  whatsappClient = client;
};

const getWhatsAppClient = () => {
  // Debugging: Check if whatsappClient is undefined
  if (whatsappClient === undefined) {
    console.warn('WhatsApp client is undefined. Ensure it is initialized properly.');
  }
  return whatsappClient;
};

module.exports = { setWhatsAppClient, whatsappClient, getWhatsAppClient };
