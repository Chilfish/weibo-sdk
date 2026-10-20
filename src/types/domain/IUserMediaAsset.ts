import type { MediaType } from './ITweet'

/**
 * 用户相册（D4，`getImageWall?has_album=true` 的 `data.album_list[]`）。
 *
 * `containerId` 是 `getAlbumDetail` 的入参；相册 tab 下发的是 `pc_profile_album`
 * 形态的 containerid，可直接用于分页拉取照片。
 */
export interface IUserAlbum {
  /** 相册 containerid（`getAlbumDetail` 入参） */
  containerId: string
  /** 相册标题（如「原创」「头像」） */
  title: string
  /** 封面图（临时 URL） */
  coverUrl?: string
}

/**
 * 用户媒体资产（D4 / D5）。
 *
 * 覆盖图片墙（`getImageWall`）、相册（`getAlbumDetail`）与视频瀑布（`getWaterFallContent`）：
 * - 图片墙 / 相册：每项是一个媒体资产（`pid`），没有完整微博；
 * - 视频瀑布：每项是一条微博，资产从 `page_info.media_info` 提取。
 *
 * 这是新增的领域模型（不是 `ITweet` 契约的一部分），字段全部按真实响应归一化。
 */
export interface IUserMediaAsset {
  /** 资产 id（图片为 `pid`；视频优先 `media_id` / `page_id`） */
  id: string
  /** 资产类型（复用 `MediaType`：pic / video / livephoto / gif / unknown） */
  type: MediaType
  /**
   * 主资源地址：
   * - 图片 / GIF / LivePhoto 静态图 → 由 `pid` 构造的 CDN 图片地址；
   * - 视频 → 最优视频直链（mp4_hd / stream_url_hd / stream_url）。
   *
   * 与 `TweetMedia` 一样是**临时签名 URL**，过期后需重新拉取。
   */
  url: string
  /** 视频封面 / LivePhoto 静态图（图片资产通常与 `url` 相同） */
  coverUrl?: string
  /** LivePhoto 的动态 `.mov` 地址（普通图片 / 视频缺省） */
  videoUrl?: string
  /** 视频时长（秒；图片缺省） */
  duration?: number
  /** 宽度（像素；上游未下发时缺省） */
  width?: number
  /** 高度（像素；上游未下发时缺省） */
  height?: number
  /**
   * 创建时间：
   * - 图片墙只有 `timeline_year` / `timeline_month`，格式为 `YYYY-MM`；
   * - 视频瀑布取微博 `created_at` 原样字符串。
   */
  createdAt?: string
  /** 来源微博的 id（图片墙 `mid` / 视频微博 `idstr`） */
  sourceTweetId?: string
  /** 来源微博的字母 id（视频瀑布的 `mblogid`；图片墙缺省） */
  sourceMblogId?: string
  /** 永久播放页（视频 `media_info.h5_url`，如 `https://video.weibo.com/show?fid=...`） */
  permanentPageUrl?: string
  /** 上游媒体对象 id（图片墙 `object_id`） */
  objectId?: string
}
