// 快取鍵前綴定義
export const CACHE_PREFIXES = {
	PRESIGNED_URL: "presigned:",
	USER_PROFILE: "user:",
	WORKER_RATINGS: "worker_ratings:",
	EMPLOYER_RATINGS: "employer_ratings:",
	NOTIFICATION_UNREAD: "notification_unread:",
	NOTIFICATION_LIST: "notification_list:",
	GIG_LIST: "gig_list:",
	GIG_DETAIL: "gig_detail:",
	GIG_SEARCH: "gig_search:",
	RATING_STATS: "rating_stats:",
	RATING_LIST: "rating_list:",
	APPLICATION_LIST: "app_list:",
	APPLICATION_DETAIL: "app_detail:",
};

// 快取過期時間定義（秒）
export const CACHE_TTL = {
	PRESIGNED_URL: 3600, // 1 小時
	USER_PROFILE: 3600, // 1 小時
	RATINGS: 1800, // 30 分鐘
	NOTIFICATION: 300, // 5 分鐘
	GIG_LIST: 600, // 10 分鐘
	GIG_DETAIL: 1800, // 30 分鐘
	GIG_SEARCH: 300, // 5 分鐘
	RATING_STATS: 3600, // 1 小時
	RATING_LIST: 900, // 15 分鐘
	APPLICATION_LIST: 900, // 15 分鐘
	APPLICATION_DETAIL: 1800, // 30 分鐘
};
