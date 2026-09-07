import type { District } from "./types";

/**
 * Costa Rican districts (493), the third and final level of the
 * administrative hierarchy: province → cantón → distrito.
 *
 * GENERATED from the official province/cantón/district/postal-code table
 * supplied with this repository
 * (`Provincias-Cantones-Distritos-CodigosPostales.html`). The postal code IS
 * the district code, which is what makes the hierarchy self-describing:
 *
 *   `10101` → province "1" · cantón "101" · district "10101"
 *
 * so `cantonCode` below is always `code.slice(0, 3)`. It is duplicated onto
 * every row anyway, exactly as `Canton.provinceCode` is, so filtering never has
 * to know how the code is composed.
 *
 * Codes are strings, never numbers — every one of them would lose meaning as an
 * integer (see the note in ./types.ts).
 *
 * ⚠ ONE ROW IS NOT FROM THE SOURCE TABLE: Monteverde (61201). The canton was
 * created in 2020 out of Puntarenas' Monte Verde district and postdates the
 * table, which still lists the territory as 60109 under canton 601. Without the
 * addition, canton 612 — which IS in CANTONES — would offer no district at all.
 * The stale 60109 row is left in place rather than removed, because addresses
 * saved under it are real and removing it would orphan them.
 */
export const DISTRICTS: readonly District[] = [
  // ═════════════════════ San José ═════════════════════

  // ───── San José (101) ─────
  { code: "10101", name: "Carmen",                   cantonCode: "101" },
  { code: "10102", name: "Merced",                   cantonCode: "101" },
  { code: "10103", name: "Hospital",                 cantonCode: "101" },
  { code: "10104", name: "Catedral",                 cantonCode: "101" },
  { code: "10105", name: "Zapote",                   cantonCode: "101" },
  { code: "10106", name: "San Francisco de Dos Ríos", cantonCode: "101" },
  { code: "10107", name: "Uruca",                    cantonCode: "101" },
  { code: "10108", name: "Mata Redonda",             cantonCode: "101" },
  { code: "10109", name: "Pavas",                    cantonCode: "101" },
  { code: "10110", name: "Hatillo",                  cantonCode: "101" },
  { code: "10111", name: "San Sebastián",            cantonCode: "101" },

  // ───── Escazú (102) ─────
  { code: "10201", name: "Escazú",                   cantonCode: "102" },
  { code: "10202", name: "San Antonio",              cantonCode: "102" },
  { code: "10203", name: "San Rafael",               cantonCode: "102" },

  // ───── Desamparados (103) ─────
  { code: "10301", name: "Desamparados",             cantonCode: "103" },
  { code: "10302", name: "San Miguel",               cantonCode: "103" },
  { code: "10303", name: "San Juan de Dios",         cantonCode: "103" },
  { code: "10304", name: "San Rafael Arriba",        cantonCode: "103" },
  { code: "10305", name: "San Antonio",              cantonCode: "103" },
  { code: "10306", name: "Frailes",                  cantonCode: "103" },
  { code: "10307", name: "Patarrá",                  cantonCode: "103" },
  { code: "10308", name: "San Cristóbal",            cantonCode: "103" },
  { code: "10309", name: "Rosario",                  cantonCode: "103" },
  { code: "10310", name: "Damas",                    cantonCode: "103" },
  { code: "10311", name: "San Rafael Abajo",         cantonCode: "103" },
  { code: "10312", name: "Gravilias",                cantonCode: "103" },
  { code: "10313", name: "Los Guido",                cantonCode: "103" },

  // ───── Puriscal (104) ─────
  { code: "10401", name: "Santiago",                 cantonCode: "104" },
  { code: "10402", name: "Mercedes Sur",             cantonCode: "104" },
  { code: "10403", name: "Barbacoas",                cantonCode: "104" },
  { code: "10404", name: "Grifo Alto",               cantonCode: "104" },
  { code: "10405", name: "San Rafael",               cantonCode: "104" },
  { code: "10406", name: "Candelarita",              cantonCode: "104" },
  { code: "10407", name: "Desamparaditos",           cantonCode: "104" },
  { code: "10408", name: "San Antonio",              cantonCode: "104" },
  { code: "10409", name: "Chires",                   cantonCode: "104" },

  // ───── Tarrazú (105) ─────
  { code: "10501", name: "San Marcos",               cantonCode: "105" },
  { code: "10502", name: "San Lorenzo",              cantonCode: "105" },
  { code: "10503", name: "San Carlos",               cantonCode: "105" },

  // ───── Aserrí (106) ─────
  { code: "10601", name: "Aserrí",                   cantonCode: "106" },
  { code: "10602", name: "Tarbaca",                  cantonCode: "106" },
  { code: "10603", name: "Vuelta de Jorco",          cantonCode: "106" },
  { code: "10604", name: "San Gabriel",              cantonCode: "106" },
  { code: "10605", name: "Legua",                    cantonCode: "106" },
  { code: "10606", name: "Monterrey",                cantonCode: "106" },
  { code: "10607", name: "Salitrillos",              cantonCode: "106" },

  // ───── Mora (107) ─────
  { code: "10701", name: "Colón",                    cantonCode: "107" },
  { code: "10702", name: "Guayabo",                  cantonCode: "107" },
  { code: "10703", name: "Tabarcia",                 cantonCode: "107" },
  { code: "10704", name: "Piedras Negras",           cantonCode: "107" },
  { code: "10705", name: "Picagres",                 cantonCode: "107" },
  { code: "10706", name: "Jaris",                    cantonCode: "107" },
  { code: "10707", name: "Quitirrisí",               cantonCode: "107" },

  // ───── Goicoechea (108) ─────
  { code: "10801", name: "Guadalupe",                cantonCode: "108" },
  { code: "10802", name: "San Francisco",            cantonCode: "108" },
  { code: "10803", name: "Calle Blancos",            cantonCode: "108" },
  { code: "10804", name: "Mata de Plátano",          cantonCode: "108" },
  { code: "10805", name: "Ipís",                     cantonCode: "108" },
  { code: "10806", name: "Rancho Redondo",           cantonCode: "108" },
  { code: "10807", name: "Purral",                   cantonCode: "108" },

  // ───── Santa Ana (109) ─────
  { code: "10901", name: "Santa Ana",                cantonCode: "109" },
  { code: "10902", name: "Salitral",                 cantonCode: "109" },
  { code: "10903", name: "Pozos",                    cantonCode: "109" },
  { code: "10904", name: "Uruca",                    cantonCode: "109" },
  { code: "10905", name: "Piedades",                 cantonCode: "109" },
  { code: "10906", name: "Brasil",                   cantonCode: "109" },

  // ───── Alajuelita (110) ─────
  { code: "11001", name: "Alajuelita",               cantonCode: "110" },
  { code: "11002", name: "San Josecito",             cantonCode: "110" },
  { code: "11003", name: "San Antonio",              cantonCode: "110" },
  { code: "11004", name: "Concepción",               cantonCode: "110" },
  { code: "11005", name: "San Felipe",               cantonCode: "110" },

  // ───── Vázquez de Coronado (111) ─────
  { code: "11101", name: "San Isidro",               cantonCode: "111" },
  { code: "11102", name: "San Rafael",               cantonCode: "111" },
  { code: "11103", name: "Dulce Nombre de Jesús",    cantonCode: "111" },
  { code: "11104", name: "Patalillo",                cantonCode: "111" },
  { code: "11105", name: "Cascajal",                 cantonCode: "111" },

  // ───── Acosta (112) ─────
  { code: "11201", name: "San Ignacio",              cantonCode: "112" },
  { code: "11202", name: "Guaitil",                  cantonCode: "112" },
  { code: "11203", name: "Palmichal",                cantonCode: "112" },
  { code: "11204", name: "Cangrejal",                cantonCode: "112" },
  { code: "11205", name: "Sabanillas",               cantonCode: "112" },

  // ───── Tibás (113) ─────
  { code: "11301", name: "San Juan",                 cantonCode: "113" },
  { code: "11302", name: "Cinco Esquinas",           cantonCode: "113" },
  { code: "11303", name: "Anselmo Llorente",         cantonCode: "113" },
  { code: "11304", name: "León XIII",                cantonCode: "113" },
  { code: "11305", name: "Colima",                   cantonCode: "113" },

  // ───── Moravia (114) ─────
  { code: "11401", name: "San Vicente",              cantonCode: "114" },
  { code: "11402", name: "San Jerónimo",             cantonCode: "114" },
  { code: "11403", name: "La Trinidad",              cantonCode: "114" },

  // ───── Montes de Oca (115) ─────
  { code: "11501", name: "San Pedro",                cantonCode: "115" },
  { code: "11502", name: "Sabanilla",                cantonCode: "115" },
  { code: "11503", name: "Mercedes",                 cantonCode: "115" },
  { code: "11504", name: "San Rafael",               cantonCode: "115" },

  // ───── Turrubares (116) ─────
  { code: "11601", name: "San Pablo",                cantonCode: "116" },
  { code: "11602", name: "San Pedro",                cantonCode: "116" },
  { code: "11603", name: "San Juan de Mata",         cantonCode: "116" },
  { code: "11604", name: "San Luis",                 cantonCode: "116" },
  { code: "11605", name: "Carara",                   cantonCode: "116" },

  // ───── Dota (117) ─────
  { code: "11701", name: "Santa María",              cantonCode: "117" },
  { code: "11702", name: "Jardín",                   cantonCode: "117" },
  { code: "11703", name: "Copey",                    cantonCode: "117" },

  // ───── Curridabat (118) ─────
  { code: "11801", name: "Curridabat",               cantonCode: "118" },
  { code: "11802", name: "Granadilla",               cantonCode: "118" },
  { code: "11803", name: "Sánchez",                  cantonCode: "118" },
  { code: "11804", name: "Tirrases",                 cantonCode: "118" },

  // ───── Pérez Zeledón (119) ─────
  { code: "11901", name: "San Isidro de El General", cantonCode: "119" },
  { code: "11902", name: "El General",               cantonCode: "119" },
  { code: "11903", name: "Daniel Flores",            cantonCode: "119" },
  { code: "11904", name: "Rivas",                    cantonCode: "119" },
  { code: "11905", name: "San Pedro",                cantonCode: "119" },
  { code: "11906", name: "Platanares",               cantonCode: "119" },
  { code: "11907", name: "Pejibaye",                 cantonCode: "119" },
  { code: "11908", name: "Cajón",                    cantonCode: "119" },
  { code: "11909", name: "Barú",                     cantonCode: "119" },
  { code: "11910", name: "Río Nuevo",                cantonCode: "119" },
  { code: "11911", name: "Páramo",                   cantonCode: "119" },
  { code: "11912", name: "La Amistad",               cantonCode: "119" },

  // ───── León Cortés Castro (120) ─────
  { code: "12001", name: "San Pablo",                cantonCode: "120" },
  { code: "12002", name: "San Andrés",               cantonCode: "120" },
  { code: "12003", name: "Llano Bonito",             cantonCode: "120" },
  { code: "12004", name: "San Isidro",               cantonCode: "120" },
  { code: "12005", name: "Santa Cruz",               cantonCode: "120" },
  { code: "12006", name: "San Antonio",              cantonCode: "120" },

  // ═════════════════════ Alajuela ═════════════════════

  // ───── Alajuela (201) ─────
  { code: "20101", name: "Alajuela",                 cantonCode: "201" },
  { code: "20102", name: "San José",                 cantonCode: "201" },
  { code: "20103", name: "Carrizal",                 cantonCode: "201" },
  { code: "20104", name: "San Antonio",              cantonCode: "201" },
  { code: "20105", name: "Guácima",                  cantonCode: "201" },
  { code: "20106", name: "San Isidro",               cantonCode: "201" },
  { code: "20107", name: "Sabanilla",                cantonCode: "201" },
  { code: "20108", name: "San Rafael",               cantonCode: "201" },
  { code: "20109", name: "Río Segundo",              cantonCode: "201" },
  { code: "20110", name: "Desamparados",             cantonCode: "201" },
  { code: "20111", name: "Turrúcares",               cantonCode: "201" },
  { code: "20112", name: "Tambor",                   cantonCode: "201" },
  { code: "20113", name: "Garita",                   cantonCode: "201" },
  { code: "20114", name: "Sarapiquí",                cantonCode: "201" },

  // ───── San Ramón (202) ─────
  { code: "20201", name: "San Ramón",                cantonCode: "202" },
  { code: "20202", name: "Santiago",                 cantonCode: "202" },
  { code: "20203", name: "San Juan",                 cantonCode: "202" },
  { code: "20204", name: "Piedades Norte",           cantonCode: "202" },
  { code: "20205", name: "Piedades Sur",             cantonCode: "202" },
  { code: "20206", name: "San Rafael",               cantonCode: "202" },
  { code: "20207", name: "San Isidro",               cantonCode: "202" },
  { code: "20208", name: "Ángeles",                  cantonCode: "202" },
  { code: "20209", name: "Alfaro",                   cantonCode: "202" },
  { code: "20210", name: "Volio",                    cantonCode: "202" },
  { code: "20211", name: "Concepción",               cantonCode: "202" },
  { code: "20212", name: "Zapotal",                  cantonCode: "202" },
  { code: "20213", name: "Peñas Blancas",            cantonCode: "202" },
  { code: "20214", name: "San Lorenzo",              cantonCode: "202" },

  // ───── Grecia (203) ─────
  { code: "20301", name: "Grecia",                   cantonCode: "203" },
  { code: "20302", name: "San Isidro",               cantonCode: "203" },
  { code: "20303", name: "San José",                 cantonCode: "203" },
  { code: "20304", name: "San Roque",                cantonCode: "203" },
  { code: "20305", name: "Tacares",                  cantonCode: "203" },
  { code: "20307", name: "Puente de Piedra",         cantonCode: "203" },
  { code: "20308", name: "Bolívar",                  cantonCode: "203" },

  // ───── San Mateo (204) ─────
  { code: "20401", name: "San Mateo",                cantonCode: "204" },
  { code: "20402", name: "Desmonte",                 cantonCode: "204" },
  { code: "20403", name: "Jesús María",              cantonCode: "204" },
  { code: "20404", name: "Labrador",                 cantonCode: "204" },

  // ───── Atenas (205) ─────
  { code: "20501", name: "Atenas",                   cantonCode: "205" },
  { code: "20502", name: "Jesús",                    cantonCode: "205" },
  { code: "20503", name: "Mercedes",                 cantonCode: "205" },
  { code: "20504", name: "San Isidro",               cantonCode: "205" },
  { code: "20505", name: "Concepción",               cantonCode: "205" },
  { code: "20506", name: "San José",                 cantonCode: "205" },
  { code: "20507", name: "Santa Eulalia",            cantonCode: "205" },
  { code: "20508", name: "Escobal",                  cantonCode: "205" },

  // ───── Naranjo (206) ─────
  { code: "20601", name: "Naranjo",                  cantonCode: "206" },
  { code: "20602", name: "San Miguel",               cantonCode: "206" },
  { code: "20603", name: "San José",                 cantonCode: "206" },
  { code: "20604", name: "Cirrí Sur",                cantonCode: "206" },
  { code: "20605", name: "San Jerónimo",             cantonCode: "206" },
  { code: "20606", name: "San Juan",                 cantonCode: "206" },
  { code: "20607", name: "El Rosario",               cantonCode: "206" },
  { code: "20608", name: "Palmitos",                 cantonCode: "206" },

  // ───── Palmares (207) ─────
  { code: "20701", name: "Palmares",                 cantonCode: "207" },
  { code: "20702", name: "Zaragoza",                 cantonCode: "207" },
  { code: "20703", name: "Buenos Aires",             cantonCode: "207" },
  { code: "20704", name: "Santiago",                 cantonCode: "207" },
  { code: "20705", name: "Candelaria",               cantonCode: "207" },
  { code: "20706", name: "Esquipulas",               cantonCode: "207" },
  { code: "20707", name: "La Granja",                cantonCode: "207" },

  // ───── Poás (208) ─────
  { code: "20801", name: "San Pedro",                cantonCode: "208" },
  { code: "20802", name: "San Juan",                 cantonCode: "208" },
  { code: "20803", name: "San Rafael",               cantonCode: "208" },
  { code: "20804", name: "Carrillos",                cantonCode: "208" },
  { code: "20805", name: "Sabana Redonda",           cantonCode: "208" },

  // ───── Orotina (209) ─────
  { code: "20901", name: "Orotina",                  cantonCode: "209" },
  { code: "20902", name: "El Mastate",               cantonCode: "209" },
  { code: "20903", name: "Hacienda Vieja",           cantonCode: "209" },
  { code: "20904", name: "Coyolar",                  cantonCode: "209" },
  { code: "20905", name: "La Ceiba",                 cantonCode: "209" },

  // ───── San Carlos (210) ─────
  { code: "21001", name: "Quesada",                  cantonCode: "210" },
  { code: "21002", name: "Florencia",                cantonCode: "210" },
  { code: "21003", name: "Buenavista",               cantonCode: "210" },
  { code: "21004", name: "Aguas Zarcas",             cantonCode: "210" },
  { code: "21005", name: "Venecia",                  cantonCode: "210" },
  { code: "21006", name: "Pital",                    cantonCode: "210" },
  { code: "21007", name: "La Fortuna",               cantonCode: "210" },
  { code: "21008", name: "La Tigra",                 cantonCode: "210" },
  { code: "21009", name: "La Palmera",               cantonCode: "210" },
  { code: "21010", name: "Venado",                   cantonCode: "210" },
  { code: "21011", name: "Cutris",                   cantonCode: "210" },
  { code: "21012", name: "Monterrey",                cantonCode: "210" },
  { code: "21013", name: "Pocosol",                  cantonCode: "210" },

  // ───── Zarcero (211) ─────
  { code: "21101", name: "Zarcero",                  cantonCode: "211" },
  { code: "21102", name: "Laguna",                   cantonCode: "211" },
  { code: "21103", name: "Tapesco",                  cantonCode: "211" },
  { code: "21104", name: "Guadalupe",                cantonCode: "211" },
  { code: "21105", name: "Palmira",                  cantonCode: "211" },
  { code: "21106", name: "Zapote",                   cantonCode: "211" },
  { code: "21107", name: "Brisas",                   cantonCode: "211" },

  // ───── Sarchí (212) ─────
  { code: "21201", name: "Sarchí Norte",             cantonCode: "212" },
  { code: "21202", name: "Sarchí Sur",               cantonCode: "212" },
  { code: "21203", name: "Toro Amarillo",            cantonCode: "212" },
  { code: "21204", name: "San Pedro",                cantonCode: "212" },
  { code: "21205", name: "Rodríguez",                cantonCode: "212" },

  // ───── Upala (213) ─────
  { code: "21301", name: "Upala",                    cantonCode: "213" },
  { code: "21302", name: "Aguas Claras",             cantonCode: "213" },
  { code: "21303", name: "San José",                 cantonCode: "213" },
  { code: "21304", name: "Bijagua",                  cantonCode: "213" },
  { code: "21305", name: "Delicias",                 cantonCode: "213" },
  { code: "21306", name: "Dos Ríos",                 cantonCode: "213" },
  { code: "21307", name: "Yolillal",                 cantonCode: "213" },
  { code: "21308", name: "Canalete",                 cantonCode: "213" },

  // ───── Los Chiles (214) ─────
  { code: "21401", name: "Los Chiles",               cantonCode: "214" },
  { code: "21402", name: "Caño Negro",               cantonCode: "214" },
  { code: "21403", name: "El Amparo",                cantonCode: "214" },
  { code: "21404", name: "San Jorge",                cantonCode: "214" },

  // ───── Guatuso (215) ─────
  { code: "21501", name: "San Rafael",               cantonCode: "215" },
  { code: "21502", name: "Buenavista",               cantonCode: "215" },
  { code: "21503", name: "Cote",                     cantonCode: "215" },
  { code: "21504", name: "Katira",                   cantonCode: "215" },

  // ───── Río Cuarto (216) ─────
  { code: "21601", name: "Río Cuarto",               cantonCode: "216" },
  { code: "21602", name: "Santa Rita",               cantonCode: "216" },
  { code: "21603", name: "Santa Isabel",             cantonCode: "216" },

  // ═════════════════════ Cartago ═════════════════════

  // ───── Cartago (301) ─────
  { code: "30101", name: "Oriental",                 cantonCode: "301" },
  { code: "30102", name: "Occidental",               cantonCode: "301" },
  { code: "30103", name: "Carmen",                   cantonCode: "301" },
  { code: "30104", name: "San Nicolás",              cantonCode: "301" },
  { code: "30105", name: "Aguacaliente",             cantonCode: "301" },
  { code: "30106", name: "Guadalupe",                cantonCode: "301" },
  { code: "30107", name: "Corralillo",               cantonCode: "301" },
  { code: "30108", name: "Tierra Blanca",            cantonCode: "301" },
  { code: "30109", name: "Dulce Nombre",             cantonCode: "301" },
  { code: "30110", name: "Llano Grande",             cantonCode: "301" },
  { code: "30111", name: "Quebradilla",              cantonCode: "301" },

  // ───── Paraíso (302) ─────
  { code: "30201", name: "Paraíso",                  cantonCode: "302" },
  { code: "30202", name: "Santiago",                 cantonCode: "302" },
  { code: "30203", name: "Orosi",                    cantonCode: "302" },
  { code: "30204", name: "Cachí",                    cantonCode: "302" },
  { code: "30205", name: "Llanos de Santa Lucía",    cantonCode: "302" },
  { code: "30206", name: "Birrisito",                cantonCode: "302" },

  // ───── La Unión (303) ─────
  { code: "30301", name: "Tres Ríos",                cantonCode: "303" },
  { code: "30302", name: "San Diego",                cantonCode: "303" },
  { code: "30303", name: "San Juan",                 cantonCode: "303" },
  { code: "30304", name: "San Rafael",               cantonCode: "303" },
  { code: "30305", name: "Concepción",               cantonCode: "303" },
  { code: "30306", name: "Dulce Nombre",             cantonCode: "303" },
  { code: "30307", name: "San Ramón",                cantonCode: "303" },
  { code: "30308", name: "Río Azul",                 cantonCode: "303" },

  // ───── Jiménez (304) ─────
  { code: "30401", name: "Juan Viñas",               cantonCode: "304" },
  { code: "30402", name: "Tucurrique",               cantonCode: "304" },
  { code: "30403", name: "Pejibaye",                 cantonCode: "304" },
  { code: "30404", name: "La Victoria",              cantonCode: "304" },

  // ───── Turrialba (305) ─────
  { code: "30501", name: "Turrialba",                cantonCode: "305" },
  { code: "30502", name: "La Suiza",                 cantonCode: "305" },
  { code: "30503", name: "Peralta",                  cantonCode: "305" },
  { code: "30504", name: "Santa Cruz",               cantonCode: "305" },
  { code: "30505", name: "Santa Teresita",           cantonCode: "305" },
  { code: "30506", name: "Pavones",                  cantonCode: "305" },
  { code: "30507", name: "Tuis",                     cantonCode: "305" },
  { code: "30508", name: "Tayutic",                  cantonCode: "305" },
  { code: "30509", name: "Santa Rosa",               cantonCode: "305" },
  { code: "30510", name: "Tres Equis",               cantonCode: "305" },
  { code: "30511", name: "La Isabel",                cantonCode: "305" },
  { code: "30512", name: "Chirripó",                 cantonCode: "305" },

  // ───── Alvarado (306) ─────
  { code: "30601", name: "Pacayas",                  cantonCode: "306" },
  { code: "30602", name: "Cervantes",                cantonCode: "306" },
  { code: "30603", name: "Capellades",               cantonCode: "306" },

  // ───── Oreamuno (307) ─────
  { code: "30701", name: "San Rafael",               cantonCode: "307" },
  { code: "30702", name: "Cot",                      cantonCode: "307" },
  { code: "30703", name: "Potrero Cerrado",          cantonCode: "307" },
  { code: "30704", name: "Cipreses",                 cantonCode: "307" },
  { code: "30705", name: "Santa Rosa",               cantonCode: "307" },

  // ───── El Guarco (308) ─────
  { code: "30801", name: "El Tejar",                 cantonCode: "308" },
  { code: "30802", name: "San Isidro",               cantonCode: "308" },
  { code: "30803", name: "Tobosi",                   cantonCode: "308" },
  { code: "30804", name: "Patio de Agua",            cantonCode: "308" },

  // ═════════════════════ Heredia ═════════════════════

  // ───── Heredia (401) ─────
  { code: "40101", name: "Heredia",                  cantonCode: "401" },
  { code: "40102", name: "Mercedes",                 cantonCode: "401" },
  { code: "40103", name: "San Francisco",            cantonCode: "401" },
  { code: "40104", name: "Ulloa",                    cantonCode: "401" },
  { code: "40105", name: "Varablanca",               cantonCode: "401" },

  // ───── Barva (402) ─────
  { code: "40201", name: "Barva",                    cantonCode: "402" },
  { code: "40202", name: "San Pedro",                cantonCode: "402" },
  { code: "40203", name: "San Pablo",                cantonCode: "402" },
  { code: "40204", name: "San Roque",                cantonCode: "402" },
  { code: "40205", name: "Santa Lucía",              cantonCode: "402" },
  { code: "40206", name: "San José de la Montaña",   cantonCode: "402" },

  // ───── Santo Domingo (403) ─────
  { code: "40301", name: "Santo Domingo",            cantonCode: "403" },
  { code: "40302", name: "San Vicente",              cantonCode: "403" },
  { code: "40303", name: "San Miguel",               cantonCode: "403" },
  { code: "40304", name: "Paracito",                 cantonCode: "403" },
  { code: "40305", name: "Santo Tomás",              cantonCode: "403" },
  { code: "40306", name: "Santa Rosa",               cantonCode: "403" },
  { code: "40307", name: "Tures",                    cantonCode: "403" },
  { code: "40308", name: "Pará",                     cantonCode: "403" },

  // ───── Santa Bárbara (404) ─────
  { code: "40401", name: "Santa Bárbara",            cantonCode: "404" },
  { code: "40402", name: "San Pedro",                cantonCode: "404" },
  { code: "40403", name: "San Juan",                 cantonCode: "404" },
  { code: "40404", name: "Jesús",                    cantonCode: "404" },
  { code: "40405", name: "Santo Domingo",            cantonCode: "404" },
  { code: "40406", name: "Purabá",                   cantonCode: "404" },

  // ───── San Rafael (405) ─────
  { code: "40501", name: "San Rafael",               cantonCode: "405" },
  { code: "40502", name: "San Josecito",             cantonCode: "405" },
  { code: "40503", name: "Santiago",                 cantonCode: "405" },
  { code: "40504", name: "Ángeles",                  cantonCode: "405" },
  { code: "40505", name: "Concepción",               cantonCode: "405" },

  // ───── San Isidro (406) ─────
  { code: "40601", name: "San Isidro",               cantonCode: "406" },
  { code: "40602", name: "San José",                 cantonCode: "406" },
  { code: "40603", name: "Concepción",               cantonCode: "406" },
  { code: "40604", name: "San Francisco",            cantonCode: "406" },

  // ───── Belén (407) ─────
  { code: "40701", name: "San Antonio",              cantonCode: "407" },
  { code: "40702", name: "La Ribera",                cantonCode: "407" },
  { code: "40703", name: "La Asunción",              cantonCode: "407" },

  // ───── Flores (408) ─────
  { code: "40801", name: "San Joaquín",              cantonCode: "408" },
  { code: "40802", name: "Barrantes",                cantonCode: "408" },
  { code: "40803", name: "Llorente",                 cantonCode: "408" },

  // ───── San Pablo (409) ─────
  { code: "40901", name: "San Pablo",                cantonCode: "409" },
  { code: "40902", name: "Rincón de Sabanilla",      cantonCode: "409" },

  // ───── Sarapiquí (410) ─────
  { code: "41001", name: "Puerto Viejo",             cantonCode: "410" },
  { code: "41002", name: "La Virgen",                cantonCode: "410" },
  { code: "41003", name: "Las Horquetas",            cantonCode: "410" },
  { code: "41004", name: "Llanuras del Gaspar",      cantonCode: "410" },
  { code: "41005", name: "Cureña",                   cantonCode: "410" },

  // ═════════════════════ Guanacaste ═════════════════════

  // ───── Liberia (501) ─────
  { code: "50101", name: "Liberia",                  cantonCode: "501" },
  { code: "50102", name: "Cañas Dulces",             cantonCode: "501" },
  { code: "50103", name: "Mayorga",                  cantonCode: "501" },
  { code: "50104", name: "Nacascolo",                cantonCode: "501" },
  { code: "50105", name: "Curubandé",                cantonCode: "501" },

  // ───── Nicoya (502) ─────
  { code: "50201", name: "Nicoya",                   cantonCode: "502" },
  { code: "50202", name: "Mansión",                  cantonCode: "502" },
  { code: "50203", name: "San Antonio",              cantonCode: "502" },
  { code: "50204", name: "Quebrada Honda",           cantonCode: "502" },
  { code: "50205", name: "Sámara",                   cantonCode: "502" },
  { code: "50206", name: "Nosara",                   cantonCode: "502" },
  { code: "50207", name: "Belén de Nosarita",        cantonCode: "502" },

  // ───── Santa Cruz (503) ─────
  { code: "50301", name: "Santa Cruz",               cantonCode: "503" },
  { code: "50302", name: "Bolsón",                   cantonCode: "503" },
  { code: "50303", name: "Veintisiete de Abril",     cantonCode: "503" },
  { code: "50304", name: "Tempate",                  cantonCode: "503" },
  { code: "50305", name: "Cartagena",                cantonCode: "503" },
  { code: "50306", name: "Cuajiniquil",              cantonCode: "503" },
  { code: "50307", name: "Diriá",                    cantonCode: "503" },
  { code: "50308", name: "Cabo Velas",               cantonCode: "503" },
  { code: "50309", name: "Tamarindo",                cantonCode: "503" },

  // ───── Bagaces (504) ─────
  { code: "50401", name: "Bagaces",                  cantonCode: "504" },
  { code: "50402", name: "La Fortuna",               cantonCode: "504" },
  { code: "50403", name: "Mogote",                   cantonCode: "504" },
  { code: "50404", name: "Río Naranjo",              cantonCode: "504" },
  { code: "50405", name: "Pijije",                   cantonCode: "504" },

  // ───── Carrillo (505) ─────
  { code: "50501", name: "Filadelfia",               cantonCode: "505" },
  { code: "50502", name: "Palmira",                  cantonCode: "505" },
  { code: "50503", name: "Sardinal",                 cantonCode: "505" },
  { code: "50504", name: "Belén",                    cantonCode: "505" },

  // ───── Cañas (506) ─────
  { code: "50601", name: "Cañas",                    cantonCode: "506" },
  { code: "50602", name: "Palmira",                  cantonCode: "506" },
  { code: "50603", name: "San Miguel",               cantonCode: "506" },
  { code: "50604", name: "Bebedero",                 cantonCode: "506" },
  { code: "50605", name: "Porozal",                  cantonCode: "506" },

  // ───── Abangares (507) ─────
  { code: "50701", name: "Las Juntas",               cantonCode: "507" },
  { code: "50702", name: "Sierra",                   cantonCode: "507" },
  { code: "50703", name: "San Juan",                 cantonCode: "507" },
  { code: "50704", name: "Colorado",                 cantonCode: "507" },

  // ───── Tilarán (508) ─────
  { code: "50801", name: "Tilarán",                  cantonCode: "508" },
  { code: "50802", name: "Quebrada Grande",          cantonCode: "508" },
  { code: "50803", name: "Tronadora",                cantonCode: "508" },
  { code: "50804", name: "Santa Rosa",               cantonCode: "508" },
  { code: "50805", name: "Líbano",                   cantonCode: "508" },
  { code: "50806", name: "Tierras Morenas",          cantonCode: "508" },
  { code: "50807", name: "Arenal",                   cantonCode: "508" },
  { code: "50808", name: "Cabeceras",                cantonCode: "508" },

  // ───── Nandayure (509) ─────
  { code: "50901", name: "Carmona",                  cantonCode: "509" },
  { code: "50902", name: "Santa Rita",               cantonCode: "509" },
  { code: "50903", name: "Zapotal",                  cantonCode: "509" },
  { code: "50904", name: "San Pablo",                cantonCode: "509" },
  { code: "50905", name: "Porvenir",                 cantonCode: "509" },
  { code: "50906", name: "Bejuco",                   cantonCode: "509" },

  // ───── La Cruz (510) ─────
  { code: "51001", name: "La Cruz",                  cantonCode: "510" },
  { code: "51002", name: "Santa Cecilia",            cantonCode: "510" },
  { code: "51003", name: "La Garita",                cantonCode: "510" },
  { code: "51004", name: "Santa Elena",              cantonCode: "510" },

  // ───── Hojancha (511) ─────
  { code: "51101", name: "Hojancha",                 cantonCode: "511" },
  { code: "51102", name: "Monte Romo",               cantonCode: "511" },
  { code: "51103", name: "Puerto Carrillo",          cantonCode: "511" },
  { code: "51104", name: "Huacas",                   cantonCode: "511" },
  { code: "51105", name: "Matambú",                  cantonCode: "511" },

  // ═════════════════════ Puntarenas ═════════════════════

  // ───── Puntarenas (601) ─────
  { code: "60101", name: "Puntarenas",               cantonCode: "601" },
  { code: "60102", name: "Pitahaya",                 cantonCode: "601" },
  { code: "60103", name: "Chomes",                   cantonCode: "601" },
  { code: "60104", name: "Lepanto",                  cantonCode: "601" },
  { code: "60105", name: "Paquera",                  cantonCode: "601" },
  { code: "60106", name: "Manzanillo",               cantonCode: "601" },
  { code: "60107", name: "Guacimal",                 cantonCode: "601" },
  { code: "60108", name: "Barranca",                 cantonCode: "601" },
  { code: "60109", name: "Monte Verde",              cantonCode: "601" },
  { code: "60110", name: "Isla del Coco",            cantonCode: "601" },
  { code: "60111", name: "Cóbano",                   cantonCode: "601" },
  { code: "60112", name: "Chacarita",                cantonCode: "601" },
  { code: "60113", name: "Chira",                    cantonCode: "601" },
  { code: "60114", name: "Acapulco",                 cantonCode: "601" },
  { code: "60115", name: "El Roble",                 cantonCode: "601" },
  { code: "60116", name: "Arancibia",                cantonCode: "601" },

  // ───── Esparza (602) ─────
  { code: "60201", name: "Espíritu Santo",           cantonCode: "602" },
  { code: "60202", name: "San Juan Grande",          cantonCode: "602" },
  { code: "60203", name: "Macacona",                 cantonCode: "602" },
  { code: "60204", name: "San Rafael",               cantonCode: "602" },
  { code: "60205", name: "San Jerónimo",             cantonCode: "602" },
  { code: "60206", name: "Caldera",                  cantonCode: "602" },

  // ───── Buenos Aires (603) ─────
  { code: "60301", name: "Buenos Aires",             cantonCode: "603" },
  { code: "60302", name: "Volcán",                   cantonCode: "603" },
  { code: "60303", name: "Potrero Grande",           cantonCode: "603" },
  { code: "60304", name: "Boruca",                   cantonCode: "603" },
  { code: "60305", name: "Pilas",                    cantonCode: "603" },
  { code: "60306", name: "Colinas",                  cantonCode: "603" },
  { code: "60307", name: "Chánguena",                cantonCode: "603" },
  { code: "60308", name: "Biolley",                  cantonCode: "603" },
  { code: "60309", name: "Brunka",                   cantonCode: "603" },

  // ───── Montes de Oro (604) ─────
  { code: "60401", name: "Miramar",                  cantonCode: "604" },
  { code: "60402", name: "La Unión",                 cantonCode: "604" },
  { code: "60403", name: "San Isidro",               cantonCode: "604" },

  // ───── Osa (605) ─────
  { code: "60501", name: "Puerto Cortés",            cantonCode: "605" },
  { code: "60502", name: "Palmar",                   cantonCode: "605" },
  { code: "60503", name: "Sierpe",                   cantonCode: "605" },
  { code: "60504", name: "Bahía Ballena",            cantonCode: "605" },
  { code: "60505", name: "Piedras Blancas",          cantonCode: "605" },
  { code: "60506", name: "Bahía Drake",              cantonCode: "605" },

  // ───── Quepos (606) ─────
  { code: "60601", name: "Quepos",                   cantonCode: "606" },
  { code: "60602", name: "Savegre",                  cantonCode: "606" },
  { code: "60603", name: "Naranjito",                cantonCode: "606" },

  // ───── Golfito (607) ─────
  { code: "60701", name: "Golfito",                  cantonCode: "607" },
  { code: "60703", name: "Guaycará",                 cantonCode: "607" },
  { code: "60704", name: "Pavón",                    cantonCode: "607" },

  // ───── Coto Brus (608) ─────
  { code: "60801", name: "San Vito",                 cantonCode: "608" },
  { code: "60802", name: "Sabalito",                 cantonCode: "608" },
  { code: "60803", name: "Aguabuena",                cantonCode: "608" },
  { code: "60804", name: "Limoncito",                cantonCode: "608" },
  { code: "60805", name: "Pittier",                  cantonCode: "608" },
  { code: "60806", name: "Gutiérrez Braun",          cantonCode: "608" },

  // ───── Parrita (609) ─────
  { code: "60901", name: "Parrita",                  cantonCode: "609" },

  // ───── Corredores (610) ─────
  { code: "61001", name: "Corredor",                 cantonCode: "610" },
  { code: "61002", name: "La Cuesta",                cantonCode: "610" },
  { code: "61003", name: "Canoas",                   cantonCode: "610" },
  { code: "61004", name: "Laurel",                   cantonCode: "610" },

  // ───── Garabito (611) ─────
  { code: "61101", name: "Jacó",                     cantonCode: "611" },
  { code: "61102", name: "Tárcoles",                 cantonCode: "611" },
  { code: "61103", name: "Lagunillas",               cantonCode: "611" },

  // ───── Monteverde (612) ─────
  { code: "61201", name: "Monteverde",               cantonCode: "612" },

  // ───── Puerto Jiménez (613) ─────
  { code: "61301", name: "Puerto Jiménez",           cantonCode: "613" },

  // ═════════════════════ Limón ═════════════════════

  // ───── Limón (701) ─────
  { code: "70101", name: "Limón",                    cantonCode: "701" },
  { code: "70102", name: "Valle La Estrella",        cantonCode: "701" },
  { code: "70103", name: "Río Blanco",               cantonCode: "701" },
  { code: "70104", name: "Matama",                   cantonCode: "701" },

  // ───── Pococí (702) ─────
  { code: "70201", name: "Guápiles",                 cantonCode: "702" },
  { code: "70202", name: "Jiménez",                  cantonCode: "702" },
  { code: "70203", name: "Rita",                     cantonCode: "702" },
  { code: "70204", name: "Roxana",                   cantonCode: "702" },
  { code: "70205", name: "Cariari",                  cantonCode: "702" },
  { code: "70206", name: "Colorado",                 cantonCode: "702" },
  { code: "70207", name: "La Colonia",               cantonCode: "702" },

  // ───── Siquirres (703) ─────
  { code: "70301", name: "Siquirres",                cantonCode: "703" },
  { code: "70302", name: "Pacuarito",                cantonCode: "703" },
  { code: "70303", name: "Florida",                  cantonCode: "703" },
  { code: "70304", name: "Germania",                 cantonCode: "703" },
  { code: "70305", name: "El Cairo",                 cantonCode: "703" },
  { code: "70306", name: "Alegría",                  cantonCode: "703" },
  { code: "70307", name: "Reventazón",               cantonCode: "703" },

  // ───── Talamanca (704) ─────
  { code: "70401", name: "Bratsi",                   cantonCode: "704" },
  { code: "70402", name: "Sixaola",                  cantonCode: "704" },
  { code: "70403", name: "Cahuita",                  cantonCode: "704" },
  { code: "70404", name: "Telire",                   cantonCode: "704" },

  // ───── Matina (705) ─────
  { code: "70501", name: "Matina",                   cantonCode: "705" },
  { code: "70502", name: "Batán",                    cantonCode: "705" },
  { code: "70503", name: "Carrandi",                 cantonCode: "705" },

  // ───── Guácimo (706) ─────
  { code: "70601", name: "Guácimo",                  cantonCode: "706" },
  { code: "70602", name: "Mercedes",                 cantonCode: "706" },
  { code: "70603", name: "Pocora",                   cantonCode: "706" },
  { code: "70604", name: "Río Jiménez",              cantonCode: "706" },
  { code: "70605", name: "Duacarí",                  cantonCode: "706" },
] as const;
