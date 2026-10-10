/* PUBLIC UI CONFIG: Edit per customer. Never store secrets here. */
window.MEETAB_SITE = {
  defaultRoom: 'guliskari',
  roomAliases: {gulisqari: 'guliskari'}, // Existing links remain valid.
  rooms: {
    guliskari: {backendId: 'gulisqari', name: 'გულისკარი', email: 'guliskari@ip13.onmicrosoft.com', color: '#FA6E5F', equipment: 'მაგიდა: 1 / სკამი: #'},
    room2: {name: 'ოთახი 2', email: 'room2@company.com', color: '#FA6E5F'},
    room3: {name: 'ოთახი 3', email: 'room3@company.com', color: '#FA6E5F'},
    room4: {name: 'ოთახი 4', email: 'room4@company.com', color: '#FA6E5F'}
  },
  text: {
    roomType: 'შეხვედრის ოთახი',
    defaultEquipment: 'მაგიდა: 1 / სკამი: #',
    wifiName: 'WIFI EVEX GUEST'
  },
  colors: {ink: '#303030', teal: '#148380', red: '#E8344D', paper: '#F9F9F9'},
  weather: {lat: 41.7151, lon: 44.8271, city: 'თბილისი'},
  timezone: 'Asia/Tbilisi',
  itSupportEmail: 'clinics_it_support@evex.ge' // Display only; recipient must also be configured on backend.
};

// Display/link spelling may change; preserve the existing backend/DB identity.
window.MeeTabRoom = requested => {
  const site = window.MEETAB_SITE, own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  let key = requested || site.defaultRoom;
  if (own(site.roomAliases, key)) key = site.roomAliases[key];
  const room = own(site.rooms, key) ? site.rooms[key] : null;
  // Unknown keys retain their identity so server authorization still denies them.
  return {key, id: room?.backendId || key, room: room || site.rooms[site.defaultRoom]};
};
