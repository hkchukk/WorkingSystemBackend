import areaData from "../static/AreaData.json"

export function getCities(): string[] {
	return Object.keys(areaData);
}

export function getDistricts(city: string): string[] | undefined{
	return areaData[city];
};

export function isValidCity(city: string): boolean {
	return city in areaData;
}

export function isValidDistrict(city: string, district: string): boolean {
	return areaData[city]?.includes(district) ?? false;
}
