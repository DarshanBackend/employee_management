import axios from "axios";
import { config } from 'dotenv';
config();

const GST_API_HOST = "india-gstin-validator.p.rapidapi.com";
const GST_API_KEY = process.env.RAPIDAPI_KEY || "92e35e5757msh89a94bde035c810p13d90cjsnaeb87007ba7c";

export default async function validateGSTIN(gstin) {
  try {
    const response = await axios.get(
      `https://${GST_API_HOST}/validate?gstin=${String(gstin).toUpperCase()}`,
      {
        headers: {
          "x-rapidapi-key": GST_API_KEY,
          "x-rapidapi-host": GST_API_HOST,
        },
      }
    );

    return {
      valid: response.data.valid,
      gstin: response.data.gstin,
      state: response.data.state,
      pan: response.data.pan,
    };
  } catch (error) {
    console.error("GST API ERROR:", error.response?.data || error.message || error);

    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "Unknown GST API error";

    throw new Error(message);
  }
}
