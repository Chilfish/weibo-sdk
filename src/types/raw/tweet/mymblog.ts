export interface IMyMBlogResponse {
  ok: number
  data: {
    /** 下页游标（2026-08 起 mymblog 已改用 page 分页，此字段恒为 ""；翻到底时缺省） */
    since_id?: string
    list: MyMBLog[]
    status_visible?: number
    bottom_tips_visible?: boolean
    bottom_tips_text?: string
    topicList?: any[]
    /** 总数（2026-08 起恒为 -1，防爬；翻到底时缺省） */
    total?: number
  }
}

export interface MyMBLog {
  visible: Visible
  created_at: string
  id: number
  idstr: string
  mid: string
  mblogid: string
  user: ListUser
  can_edit: boolean
  edit_count?: number
  textLength?: number
  annotations?: ListAnnotation[]
  source: ListSource
  favorited: boolean
  rid: string
  reads_count: number
  pic_ids: string[]
  geo?: Geo
  pic_num: number
  is_paid: boolean
  mblog_vip_type: number
  number_display_strategy: NumberDisplayStrategy
  reposts_count: number
  comments_count: number
  attitudes_count: number
  attitudes_status: number
  isLongText: boolean
  mlevel: number
  content_auth: number
  is_show_bulletin: number
  comment_manage_info: CommentManageInfo
  share_repost_type: number
  topic_struct?: TopicStruct[]
  url_struct?: URLStruct[]
  tag_struct?: TagStruct[]
  title?: Title
  mblogtype: number
  showFeedRepost: boolean
  showFeedComment: boolean
  pictureViewerSign: boolean
  showPictureViewer: boolean
  rcList: any[]
  mix_media_info?: MixMediaInfo
  analysis_extra: string
  readtimetype: Readtimetype
  mixed_count: number
  is_show_mixed: boolean
  mblog_feed_back_menus_format: any[]
  isAd: boolean
  isSinglePayAudio: boolean
  text: string
  text_raw: string
  region_name: string
  pic_focus_point?: PicFocusPoint[]
  pic_infos?: { [key: string]: PicInfoValue }
  repost_type?: number
  retweeted_status?: RetweetedStatus
  continue_tag?: ContinueTag
  common_struct?: ListCommonStruct[]
  mark?: string
  page_info?: PageInfo
}

interface ListAnnotation {
  photo_sub_type?: string
  from_for_live_photo?: string
  spot_type?: string
  place?: Place
  client_mblogid?: string
  source_text?: string
  phone_id?: string
  mapi_request?: boolean
}

interface Place {
  poiid: string
  title: string
  type: string
  spot_type: string
}

interface CommentManageInfo {
  comment_manage_button?: number
  comment_permission_type: number
  approval_comment_type: number
  comment_sort_type: number
  ai_play_picture_type?: number
}

interface ListCommonStruct {
  url: string
  name: string
  desc: string
  type: number
  img: string
  cover: string
  level: string
  weight: string
  btn_show_type: string
  hidden: number
  page_id: string
  actionlog: CommonStructActionlog
  ratio: number
  promotion: Promotion
}

interface CommonStructActionlog {
  act_code: string
  uid: string
  mid: number
  oid: string
  uicode: string
  cardid: string
  fid: string
  luicode: string
  lfid: string
  ext: string
  act_type?: number
  source: string
  code?: string
  mark?: string
}

interface Promotion {
  type_mask: string
  monitor_url: MonitorURL[]
  mark: string
}

interface MonitorURL {
  third_party_show: string
  third_party_click: string
}

interface ContinueTag {
  title: string
  pic: string
  scheme: string
  cleaned: boolean
}

interface Geo {
  type: string
  coordinates: number[]
}

interface MixMediaInfo {
  items: MixMediaInfoItem[]
}

interface MixMediaInfoItem {
  type: ObjectTypeEnum
  id: string
  data: ItemData
  scheme: string
  actionlog: ActionlogUnion
}

type ActionlogUnion = any[] | ActionlogActionlog

interface ActionlogActionlog {
  act_type: number
  act_code: number
  lcardid: string
  fid: string
  mid: string
  oid: string
  uuid: number
  source: ObjectTypeEnum
  ext: string
}

enum ObjectTypeEnum {
  Pic = 'pic',
  Video = 'video',
}

interface ItemData {
  thumbnail?: Bmiddle
  bmiddle?: Bmiddle
  large?: Bmiddle
  original?: Bmiddle
  largest?: Bmiddle
  mw2000?: Bmiddle
  largecover?: Bmiddle
  object_id: string
  pic_id?: string
  photo_tag?: number
  type: string
  pic_status?: number
  video?: string
  fid?: string
  page_id?: string
  object_type?: ObjectTypeEnum
  content1?: string
  content2?: string
  act_status?: number
  media_info?: MediaInfo
  page_pic?: string
  page_title?: string
  page_url?: string
  pic_info?: DataPicInfo
  oid?: string
  type_icon?: string
  author_id?: string
  authorid?: string
  warn?: string
  actionlog?: ActionlogActionlog
  short_url?: string
  video_object_id?: string
}

interface Bmiddle {
  url: string
  width: number
  height: number
  cut_type: number
  type: null | string
  croped?: boolean
}

interface MediaInfo {
  name: string
  stream_url: string
  stream_url_hd: string
  format: string
  h5_url: string
  mp4_sd_url: string
  mp4_hd_url: string
  h265_mp4_hd: string
  h265_mp4_ld: string
  inch_4_mp4_hd: string
  inch_5_mp4_hd: string
  inch_5_5_mp4_hd: string
  mp4_720p_mp4: string
  hevc_mp4_720p: string
  prefetch_type: number
  prefetch_size: number
  act_status: number
  protocol: string
  media_id: string
  origin_total_bitrate: number
  video_orientation: string
  duration: number
  forward_strategy: number
  search_scheme: string
  is_short_video: number
  vote_is_show: number
  belong_collection: number
  titles_display_time: string
  show_progress_bar: number
  show_mute_button: boolean
  ext_info: EXTInfo
  next_title: string
  kol_title: string
  play_completion_actions: PlayCompletionAction[]
  video_publish_time: number
  play_loop_type: number
  author_mid: string
  author_name: string
  extra_info: ExtraInfo
  video_download_strategy: VideoDownloadStrategy
  jump_to: number
  media_type: ObjectTypeEnum
  big_pic_info: BigPicInfo
  online_users: string
  online_users_number: number
  ttl: number
  storage_type: string
}

interface BigPicInfo {
  pic_big: BigPicInfoPicBig
  pic_small: BigPicInfoPicBig
  pic_middle: BigPicInfoPicBig
}

interface BigPicInfoPicBig {
  height: number
  url: string
  width: number
}

interface EXTInfo {
  video_orientation: string
}

interface ExtraInfo {
  sceneid: string
}

interface PlayCompletionAction {
  type: string
  icon: string
  text: string
  link: string
  btn_code: number
  show_position: number
  actionlog: PlayCompletionActionActionlog
}

interface PlayCompletionActionActionlog {
  oid: string
  act_code: number
  act_type: number
  source: ObjectTypeEnum
}

interface VideoDownloadStrategy {
  abandon_download: number
}

interface DataPicInfo {
  pic_big: PicInfoPicBig
  pic_small: PicInfoPicBig
  pic_middle: PicInfoPicBig
}

interface PicInfoPicBig {
  height: string
  url: string
  width: string
}

interface NumberDisplayStrategy {
  apply_scenario_flag: number
  display_text_min_number: number
  display_text: string
}

interface PageInfo {
  page_id: string
  page_title: string
  page_url: string
  page_pic: string
  content1: string
  type: number
  content2: string
  object_type: string
  act_status: number
  object_id: string
  actionlog: PageInfoActionlog
}

interface PageInfoActionlog {
  act_type: number
  act_code: number
  oid: string
  uuid: number
  cardid: string
  lcardid: string
  uicode: string
  luicode: string
  fid: string
  lfid: string
  ext: string
}

interface PicFocusPoint {
  focus_point: FocusPoint
  pic_id: string
}

interface FocusPoint {
  left: number
  top: number
  width: number
  height: number
}

interface PicInfoValue {
  thumbnail: Bmiddle
  bmiddle: Bmiddle
  large: Bmiddle
  original: Bmiddle
  largest: Bmiddle
  mw2000: Bmiddle
  largecover: Bmiddle
  object_id: string
  pic_id: string
  photo_tag: number
  type: PicInfoType
  pic_status: number
  focus_point?: FocusPoint
  video_object_id?: string
  video?: string
  actionlog?: ActionlogElement[]
}

interface ActionlogElement {
  mid: string
  oid: string
  act_type: number
  source: string
  code: string
  mark: string
  atype: string
  ext?: string
}

enum PicInfoType {
  GIF = 'gif',
  Pic = 'pic',
}

enum Readtimetype {
  AdMblog = 'adMblog',
  Mblog = 'mblog',
}

interface RetweetedStatus {
  visible: Visible
  created_at: string
  id: number
  idstr: string
  mid: string
  mblogid: string
  user: RetweetedStatusUser
  can_edit: boolean
  textLength: number
  annotations: RetweetedStatusAnnotation[]
  source: string
  favorited: boolean
  rid: string
  cardid?: string
  pic_ids: string[]
  pic_focus_point: PicFocusPoint[]
  geo: string
  pic_num: number
  pic_infos: { [key: string]: PicInfoValue }
  is_paid: boolean
  mblog_vip_type: number
  number_display_strategy: NumberDisplayStrategy
  title_source?: TitleSource
  reposts_count: number
  comments_count: number
  attitudes_count: number
  attitudes_status: number
  isLongText: boolean
  mlevel: number
  content_auth: number
  is_show_bulletin: number
  comment_manage_info: CommentManageInfo
  mblogtype: number
  showFeedRepost: boolean
  showFeedComment: boolean
  pictureViewerSign: boolean
  showPictureViewer: boolean
  rcList: any[]
  common_struct?: RetweetedStatusCommonStruct[]
  mixed_count: number
  is_show_mixed: boolean
  mblog_feed_back_menus_format: any[]
  isAd: boolean
  isSinglePayAudio: boolean
  text: string
  text_raw: string
  region_name: string
  buttons?: RetweetedStatusButton[]
  edit_count?: number
  mark?: string
}

interface RetweetedStatusAnnotation {
  photo_sub_type?: string
  super_exparams?: string
  client_mblogid?: string
  source_text?: string
  phone_id?: string
  mapi_request?: boolean
}

interface RetweetedStatusButton {
  type: string
  name: string
  params: PurpleParams
  actionlog: PurpleActionlog
}

interface PurpleActionlog {
  act_code: string
  oid: string
}

interface PurpleParams {
  uid: number
  disable_group: number
  extparams: Extparams
}

interface Extparams {
  followcardid: string
}

interface RetweetedStatusCommonStruct {
  url: string
  name: string
  desc: string
  img: string
  type: number
  btn_show_type: string
  page_id: string
  actionlog: CommonStructActionlog
  buttons: CommonStructButton[]
  hidden: number
}

interface CommonStructButton {
  name: string
  pic: string
  type: string
  params: FluffyParams
  actionlog: FluffyActionlog
}

interface FluffyActionlog {
  act_code: number
  uid: string
  mid: number
  oid: string
  uicode: string
  cardid: string
  fid: string
  luicode: string
  lfid: string
  ext: string
  source: string
}

interface FluffyParams {
  uid: string
  scheme: string
  type: string
  cleaned: boolean
}

interface TitleSource {
  name: string
  url: string
  image: string
}

interface RetweetedStatusUser {
  id: number
  idstr: string
  pc_new: number
  screen_name: string
  profile_image_url: string
  profile_url: string
  verified: boolean
  verified_type: number
  domain: string
  weihao: string
  status_total_counter: PurpleStatusTotalCounter
  avatar_large: string
  avatar_hd: string
  follow_me: boolean
  following: boolean
  mbrank: number
  mbtype: number
  v_plus: number | null
  user_ability: number
  planet_video: boolean
  icon_list: IconList[]
  verified_type_ext?: number
}

interface IconList {
  type: 'vip'
  data: IconListData
}

interface IconListData {
  mbrank: number
  mbtype: number
  svip: number
  vvip: number
}

interface PurpleStatusTotalCounter {
  total_cnt_format: string
  comment_cnt: string
  repost_cnt: string
  like_cnt: string
  total_cnt: string
}

interface Visible {
  type: number
  list_id: number
}

enum ListSource {
  Empty = '',
  哔哩哔哩 = '哔哩哔哩',
  微博网页版 = '微博网页版',
  微博轻享版 = '微博轻享版',
}

interface TagStruct {
  tag_name: string
  tag_scheme: string
  url_type_pic: string
  oid: string
  otype: string
  tag_type: number
  tag_hidden: number
  ori_url: string
  actionlog: TagStructActionlog
  desc: string
  is_checkin: number
}

interface TagStructActionlog {
  act_code: number
  oid: string
  uicode: string
  luicode: string
  fid: string
  ext: string
}

interface Title {
  text: string
  base_color: number
  icon_url: string
}

interface TopicStruct {
  title: string
  topic_url: string
  topic_title: string
  actionlog: PageInfoActionlog
}

interface URLStruct {
  url_title: string
  url_type_pic: string
  ori_url: string
  page_id?: string
  short_url: string
  long_url: string
  url_type: URLType
  result: boolean
  actionlog: PageInfoActionlog
  storage_type: string
  hide: number
  object_type: string
  h5_target_url: string
  need_save_obj: number
  position?: number
  pic_infos?: { [key: string]: PicInfo }
  pic_ids?: string[]
  gif_name?: string
  vip_gif?: VipGIF
  log?: string
}

interface PicInfo {
  thumbnail: Bmiddle
  bmiddle: Bmiddle
  large: Large
  woriginal: Large
}

interface Large {
  type: string
  url: string
  cut_type: number
  width: string
  height: string
  croped: boolean
}

type URLType = number | string

interface VipGIF {
  id: string
  url: string
  display_name: string
  object_type: string
  comment_id: number
  pic_ids: string[]
  biz: Biz
  target_url: string
  object_id: string
  request_oid: string
  containerid: string
  object_domain_id: string
  safe_status: number
  safe_extparam: string
  show_status: string
  act_status: string
  last_modified: string
  timestamp: number
  uuid: number
  uuidstr: string
  activate_status: string
  is_longtext: boolean
}

interface Biz {
  biz_id: string
  containerid: string
}

interface ListUser {
  id: number
  idstr: string
  pc_new: number
  screen_name: string
  profile_image_url: string
  profile_url: string
  verified: boolean
  verified_type: number
  domain: string
  weihao: string
  status_total_counter: FluffyStatusTotalCounter
  avatar_large: string
  avatar_hd: string
  follow_me: boolean
  following: boolean
  mbrank: number
  mbtype: number
  v_plus: number
  user_ability: number
  planet_video: boolean
  icon_list: IconList[]
}

interface FluffyStatusTotalCounter {
  total_cnt_format: number
  comment_cnt: string
  repost_cnt: string
  like_cnt: string
  total_cnt: string
}
