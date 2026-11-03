using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGamesAndChapters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GameId",
                table: "Tokens",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ChapterId",
                table: "Scenes",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "FeetPerSquare",
                table: "Scenes",
                type: "INTEGER",
                nullable: false,
                defaultValue: 5);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "Scenes",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Games",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Games", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Chapters",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    GameId = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Chapters", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Chapters_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tokens_GameId",
                table: "Tokens",
                column: "GameId");

            migrationBuilder.CreateIndex(
                name: "IX_Scenes_ChapterId",
                table: "Scenes",
                column: "ChapterId");

            migrationBuilder.CreateIndex(
                name: "IX_Chapters_GameId",
                table: "Chapters",
                column: "GameId");

            // Existing data moves into one default game and chapter before the foreign keys are added.
            migrationBuilder.Sql("""
                INSERT INTO Games (Id, Name) VALUES ('default', 'My Campaign');
                INSERT INTO Chapters (Id, GameId, Name, SortOrder) VALUES ('chapter-1', 'default', 'Chapter 1', 0);
                UPDATE Tokens SET GameId = 'default';
                UPDATE Scenes SET ChapterId = 'chapter-1',
                    SortOrder = (SELECT COUNT(*) FROM Scenes s2 WHERE s2.Name < Scenes.Name);
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_Scenes_Chapters_ChapterId",
                table: "Scenes",
                column: "ChapterId",
                principalTable: "Chapters",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Tokens_Games_GameId",
                table: "Tokens",
                column: "GameId",
                principalTable: "Games",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Scenes_Chapters_ChapterId",
                table: "Scenes");

            migrationBuilder.DropForeignKey(
                name: "FK_Tokens_Games_GameId",
                table: "Tokens");

            migrationBuilder.DropTable(
                name: "Chapters");

            migrationBuilder.DropTable(
                name: "Games");

            migrationBuilder.DropIndex(
                name: "IX_Tokens_GameId",
                table: "Tokens");

            migrationBuilder.DropIndex(
                name: "IX_Scenes_ChapterId",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "GameId",
                table: "Tokens");

            migrationBuilder.DropColumn(
                name: "ChapterId",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "FeetPerSquare",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "Scenes");
        }
    }
}
