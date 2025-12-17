import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    isLastPage,
    parseChapterDetails,
    parseChapterList,
    parseHomeSections,
    parseMangaDetails,
    parseSearch,
    parseTags,
    parseThumbnailUrl,
    parseViewMore
} from './BatoToParser'

import { BTLanguages,
    BTDomains,
    Metadata } from './BatoToHelper'

import { languageSettings,
    domainSettings,
    resetSettings } from './BatoToSettings'

const BATO_DOMAIN_DEFAULT = 'https://bato.to'

export const BatoToInfo: SourceInfo = {
    version: '3.1.7',
    name: 'BatoTo Dynamic Domain test4',
    icon: 'icon.png',
    author: 'niclimcy',
    authorWebsite: 'https://github.com/niclimcy',
    description: 'Extension that pulls manga from bato.to',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATO_DOMAIN_DEFAULT,
    sourceTags: [
        {
            text: 'Multi Language',
            type: BadgeColor.BLUE
        }
    ],
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.SETTINGS_UI |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo
implements
        SearchResultsProviding,
        MangaProviding,
        ChapterProviding,
        HomePageSectionsProviding
{
    constructor(private cheerio: CheerioAPI) {}

    stateManager = App.createSourceStateManager();

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        referer: `${await this.stateManager.retrieve('domain') ?? BATO_DOMAIN_DEFAULT}/`,
                        'user-agent':
                    await this.requestManager.getDefaultUserAgent()
                    }
                }
                if (request.url.includes('mangaId=')) {
                    const mangaId = request.url.replace('mangaId=', '')
                    if (mangaId)
                        request.url = await this.getThumbnailUrl(mangaId)
                }
                return request
            },
            interceptResponse: async (
                response: Response
            ): Promise<Response> => {
                return response
            }
        }
    })


    async networkRequest(path:string, param?:string): Promise<Response> {
        
        const domains = BTDomains['Domains']
            
        // Try all domains simultaneously with detailed logging
        const attemptPromises = domains.map(async (domainObj) => {
            const domain: string = domainObj.url
            const startTime = Date.now()
                
            try {
                console.log(`[TIMING] Starting request to ${domain}`)
                    
                const request = App.createRequest({
                    url: `${domain}${path}`,
                    method: 'GET',
                    param: param
                })
        
                const response = await this.requestManager.schedule(request, 1)
                const elapsed = Date.now() - startTime
                    
                console.log(`[TIMING] Domain ${domain} succeeded in ${elapsed}ms with status ${response.status}`)
                console.log(`[RESPONSE] ${domain} - Headers: ${JSON.stringify(response.headers || {})}`)
                    
                await this.stateManager.store('domain', domain)
                return response
            } 
            catch (error: any) {
                const elapsed = Date.now() - startTime
                console.log(`[TIMING] Domain ${domain} failed after ${elapsed}ms`)
                console.log(`[ERROR] ${domain} - Error type: ${error?.name || 'Unknown'}`)
                console.log(`[ERROR] ${domain} - Error message: ${error?.message || String(error)}`)
                    
                // Check for Cloudflare-specific errors
                if (error?.message?.includes('403') || error?.message?.includes('Cloudflare')) {
                    console.log(`[CLOUDFLARE] ${domain} - Cloudflare challenge detected`)
                }
                if (error?.message?.includes('timeout') || error?.message?.includes('timed out')) {
                    console.log(`[TIMEOUT] ${domain} - Request timeout after ${elapsed}ms`)
                }
                    
                throw error
            }
        })

        try {
            const fastestResponse = await Promise.any(attemptPromises)
            console.log('[TIMING] Parallel attempts completed, fastest domain succeeded')
            return fastestResponse
        } catch (aggregateError) {
            console.log('[ERROR] All mirror domains failed')
            console.log(`[ERROR] Reasons: ${(aggregateError as AggregateError)?.errors?.map((e: Error) => e.message).join(', ') || 'Unknown'}`)
            throw new Error('All domains failed')
        }
        
    }

    async getSourceMenu(): Promise<DUISection> {
        return Promise.resolve(
            App.createDUISection({
                id: 'main',
                header: 'Source Settings',
                isHidden: false,
                rows: async () => [
                    languageSettings(this.stateManager),
                    domainSettings(this.stateManager),
                    resetSettings(this.stateManager)
                ]
            })
        )
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BATO_DOMAIN_DEFAULT}/series/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.networkRequest(`/series/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.networkRequest(`/series/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterList($, mangaId)
    }

    async getChapterDetails(
        mangaId: string,
        chapterId: string
    ): Promise<ChapterDetails> {
        const response = await this.networkRequest(`/chapter/${chapterId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId)
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        const response = await this.networkRequest('/')
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        parseHomeSections($, sectionCallback)
    }

    async getViewMoreItems(
        homepageSectionId: string,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let param = ''

        switch (homepageSectionId) {
            case 'popular_updates':
                param = `?sort=views_d.za&page=${page}`
                break
            case 'latest_releases':
                param = `?sort=update.za&page=${page}`
                break
            default:
                throw new Error(
                    'Requested to getViewMoreItems for a section ID which doesn\'t exist'
                )
        }

        const langHomeFilter: boolean =
            (await this.stateManager.retrieve('language_home_filter')) ?? false
        const langs: string[] =
            (await this.stateManager.retrieve('languages')) ??
            BTLanguages.getDefault()
        param += langHomeFilter ? `&langs=${langs.join(',')}` : ''

        const response = await this.networkRequest('/browse', param)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        const manga = parseViewMore($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(
        query: SearchRequest,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let path

        // Regular search
        if (query.title) {
            path = `/search?word=${encodeURI(
                query.title ?? ''
            )}&page=${page}`
            // Tag Search
        } else {
            path = `/browse?genres=${
                query?.includedTags?.map((x: Tag) => x.id)[0]
            }&page=${page}`
        }

        const langSearchFilter: boolean =
            (await this.stateManager.retrieve('language_search_filter')) ??
            false
        const langs: string[] =
            (await this.stateManager.retrieve('languages')) ??
            BTLanguages.getDefault()

        const response = await this.networkRequest(path)
        const $ = this.cheerio.load(response.data as string)
        const manga = parseSearch($, langSearchFilter, langs)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        return parseTags()
    }

    async getThumbnailUrl(mangaId: string): Promise<string> {
        const response = await this.networkRequest(`/series/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseThumbnailUrl($)
    }

    CloudFlareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(
                `CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <${BatoTo.name}> and press the cloud icon.`
            )
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: await this.stateManager.retrieve('domain') ?? await BTDomains.getDefault(),
            method: 'GET',
            headers: {
                referer: `${await this.stateManager.retrieve('domain') ?? await BTDomains.getDefault()}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }
}
