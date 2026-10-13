import axios from "axios";

export const utilGetShippingEstimate = async (postcode, state) => {
  try {

    if (!postcode || typeof postcode !== "string" || !/^\d{4}$/.test(postcode.trim())) {
      const err = new Error("Invalid 4-digit Australian postcode.");
      err.isValidationError = true;
      throw err;
    }

    if (!state || typeof state !== "string" || !state.trim()) {
      const err = new Error("State is required (e.g., NSW, VIC, NT).");
      err.isValidationError = true;
      throw err;
    }

    const cleanedPostcode = postcode.trim();
    const inputStateUpper = state.trim().toUpperCase();
    const API_KEY = "92944ac9-842b-46e1-b527-766ddaa48d20";

    const lookupUrl = `https://australiansuburbs.au/api/lookup_postcode?postcode=${cleanedPostcode}`;
    let apiRES;
    try {
      apiRES = await axios.get(lookupUrl);
    } catch (err) {
      const e = new Error("Failed to connect to Australian Suburbs API.");
      e.isExternalApiError = true;
      throw e;
    }

    const data = apiRES?.data;
    if (!data?.postcode || !Array.isArray(data.suburbs)) {
      const err = new Error("Invalid postcode or no suburbs found in Australia.");
      err.isValidationError = true;
      throw err;
    }

    const apiStateUpper = String(data.state || "").trim().toUpperCase();
    const stateNameToCode = {
      "NEW SOUTH WALES": "NSW",
      "VICTORIA": "VIC",
      "QUEENSLAND": "QLD",
      "SOUTH AUSTRALIA": "SA",
      "WESTERN AUSTRALIA": "WA",
      "TASMANIA": "TAS",
      "NORTHERN TERRITORY": "NT",
      "AUSTRALIAN CAPITAL TERRITORY": "ACT",
    };
    const normalizedInputState = stateNameToCode[inputStateUpper] || inputStateUpper;

    if (normalizedInputState !== apiStateUpper) {
      const err = new Error(`State does not match postcode. Expected: ${data.state}`);
      err.isValidationError = true;
      throw err;
    }

    const queryParams = new URLSearchParams({
      from_postcode: "2000",
      to_postcode: cleanedPostcode,
      length: "22",
      width: "16",
      height: "7.7",
      weight: "1.5",
      service_code: "AUS_PARCEL_REGULAR",
    }).toString();

    const ausPostUrl = `https://digitalapi.auspost.com.au/postage/parcel/domestic/calculate.json?${queryParams}`;

    let response;
    try {
      response = await axios.get(ausPostUrl, { headers: { "AUTH-KEY": API_KEY } });
    } catch (err) {
      const e = new Error("Failed to connect to Australia Post API.");
      e.isExternalApiError = true;
      throw e;
    }

    const result = response?.data?.postage_result;
    if (!result || !result.total_cost) {
      const err = new Error("Australia Post did not return valid cost data.");
      err.isExternalApiError = true;
      throw err;
    }

    return {
      cost: parseFloat(result.total_cost),
      delivery_time: result.delivery_time || "N/A",
      service: result.service || "Unknown",
    };
  } catch (err) {

    throw err;
  }
};

export const utilGetShippingEstimateByPostcodeOnly = async (postcode) => {
  try {

    if (!postcode || typeof postcode !== "string" || !/^\d{4}$/.test(postcode.trim())) {
      return { success: false, message: "Invalid 4-digit Australian postcode." };
    }

    const cleanedPostcode = postcode.trim();
    const API_KEY = "92944ac9-842b-46e1-b527-766ddaa48d20";

    let apiRES;
    try {
      apiRES = await axios.get(`https://australiansuburbs.au/api/lookup_postcode?postcode=${cleanedPostcode}`);
    } catch {
      return { success: false, message: "Australian suburbs API failed." };
    }

    const data = apiRES?.data;
    if (!data?.postcode || !Array.isArray(data.suburbs) || data.suburbs.length === 0) {
      return { success: false, message: "No suburb found for this postcode." };
    }

    const detectedState = data.state;

    const queryParams = new URLSearchParams({
      from_postcode: "2000",
      to_postcode: cleanedPostcode,
      length: "22",
      width: "16",
      height: "7.7",
      weight: "1.5",
      service_code: "AUS_PARCEL_REGULAR",
    }).toString();

    let shippingRES;
    try {
      shippingRES = await axios.get(
        `https://digitalapi.auspost.com.au/postage/parcel/domestic/calculate.json?${queryParams}`,
        { headers: { "AUTH-KEY": API_KEY } }
      );
    } catch {
      return { success: false, message: "AusPost API connection failed." };
    }

    const result = shippingRES?.data?.postage_result;
    if (!result || !result.total_cost) {
      return { success: false, message: "No shipping rate found." };
    }

    return {
      success: true,
      postcode: cleanedPostcode,
      detected_state: detectedState,
      cost: parseFloat(result.total_cost),
      delivery_time: result.delivery_time || "N/A",
      service: result.service || "Unknown",
    };

  } catch {
    return { success: false, message: "Unknown internal error." };
  }
};
