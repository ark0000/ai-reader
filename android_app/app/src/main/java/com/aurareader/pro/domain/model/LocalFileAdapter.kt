package com.aurareader.pro.domain.model

/**
 * Unified domain model for a document.
 * This represents any supported offline document (PDF, EPUB, etc.)
 */
data class UnifiedDocument(
    val id: String,
    val title: String,
    val filePath: String,
    val pageCount: Int,
    val format: DocumentFormat,
    val lastAccessed: Long
)

enum class DocumentFormat {
    PDF, EPUB, UNKNOWN
}

/**
 * Adapter Pattern Interface
 * Used to standardize how we read metadata from different file formats
 * without tying the domain logic to specific parsing libraries.
 */
interface LocalFileAdapter {
    fun getSupportedFormat(): DocumentFormat
    
    /**
     * Extracts unified metadata from a raw file path.
     * Throws an exception if the file format is invalid.
     */
    @Throws(Exception::class)
    suspend fun parseMetadata(filePath: String): UnifiedDocument
}
